// Подбор похожих фильмов на основе заранее посчитанной матрицы схожести MovieLens (scripts/build-model.mjs),
// плюс «дополнительные» фильмы только из TMDB — их прогноз строится по спискам похожих TMDB и близости жанров.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const DATA = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../data')
// KINO_MODEL указывает другую папку модели (нужно scripts/backtest.mjs для сравнения моделей)
const MODEL = process.env.KINO_MODEL ?? path.join(DATA, 'model')
export const POSTERS = path.join(DATA, 'posters')

// Настройки прогноза; менять их стоит только вместе с прогоном scripts/backtest.mjs.
export const PARAMS = {
  k: 20, // соседей на один прогноз
  reg: 1, // притягивает прогнозы с малыми данными к базовой линии
  implicit: 0.3, // вес статусов без оценки («хочу»/«не хочу») относительно настоящей оценки
  genre: 0, // вес близости жанров для фильмов с данными MovieLens…
  extraGenre: 1, // …и для фильмов только из TMDB
  people: 2, // вес близости режиссёров и актёров, та же разбивка
  extraPeople: 3,
  keywords: 0, // вес близости по ключевым словам TMDB (темам), та же разбивка
  extraKeywords: 2,
}
const CAST_DEPTH = 4 // ведущих актёров, которые учитываются в близости людей
const PEOPLE_SHRINK = 2
const KEYWORD_SHRINK = 2
const GENRE_SHRINK = 5
// Статусы без оценки всё же говорят о вкусе: это отклонение от привычной оценки пользователя.
const IMPLICIT = { unseenNo: -2.5, seenNo: -2, yes: 1.2 }
const SURVEY_POOL = 200 // опрос выбирает из стольких самых популярных неотвеченных фильмов
const SURVEY_TASTE = 140 // сколько мест популярности стоит балл прогнозной (не)любви
const SURVEY_INFO = 40 // мест за стандартное отклонение разброса: спорные фильмы больше говорят о вкусе
const DAMP_VOTES = 400 // средние TMDB на малом числе голосов притягиваются к общему среднему
// Не предлагаются в опросе и в «новом для всех» (но находятся поиском, а «хочу» их возвращает).
const HIDDEN_GENRES = new Set(['документальный', 'documentary', 'реалити-шоу', 'ток-шоу', 'новости', 'мыльная опера'])
// Объединённые жанры сериалов TMDB, разложенные на соответствующие жанры фильмов
const TV_GENRES = { 'боевик и приключения': ['боевик', 'приключения'], 'нф и фэнтези': ['фантастика', 'фэнтези'], 'война и политика': ['военный'] }
const RECENT_DAYS = 730 // что считается новинкой
const LOW_EVIDENCE = 3 // при меньшем числе сигналов прогноз помечается как догадка
const MIN_RUNTIME = 60 // фильмы короче (короткометражки, спецвыпуски) не предлагаются
// Пересборки и компиляции фильмов, которые уже есть в каталоге (id TMDB).
const HIDDEN_TMDB = new Set([414419]) // Kill Bill: The Whole Bloody Affair
const EXTRA_ID = 10_000_000 // id фильмов только из TMDB: EXTRA_ID + tmdb id
const TV_ID = 20_000_000 // id сериалов: TV_ID + tmdb id

// Фильмы с данными коллаборативной фильтрации; индекс в этом массиве = строка матрицы схожести.
const catalog = JSON.parse(fs.readFileSync(path.join(MODEL, 'catalog.json'), 'utf8'))
const N = catalog.length
const simBuf = fs.readFileSync(path.join(MODEL, 'sim.bin'))
const sim = new Int8Array(simBuf.buffer, simBuf.byteOffset, N * N)

// Wikidata: русские названия и id Кинопоиска, по id фильма
const extraFile = path.join(MODEL, 'extra.json')
const wikidata = fs.existsSync(extraFile) ? JSON.parse(fs.readFileSync(extraFile, 'utf8')) : {}
for (const m of catalog) {
  const e = wikidata[m.id]
  if (e?.ru) m.titleRu = e.ru
  if (e?.kp) m.kp = e.kp
}

// Всё, что предлагается: сначала каталог (в том же порядке, что в матрице), потом дополнения TMDB, потом сериалы (kind: 'tv').
export const movies = [...catalog]
// старый id фильма (когда он был «только из TMDB») -> его id в каталоге сейчас; разовая миграция базы
export const movedIds = new Map()
// позиция дополнительного фильма -> [[позиция похожего фильма, вес]]
const neighbours = new Map()
export let surveyOrder = movies

const tmdbFile = path.join(MODEL, 'tmdb.json')
if (fs.existsSync(tmdbFile)) {
  const { films, extras, tv = {}, tvIds = [] } = JSON.parse(fs.readFileSync(tmdbFile, 'utf8'))
  const posters = new Set(fs.existsSync(POSTERS) ? fs.readdirSync(POSTERS) : [])
  const enrich = (m, f, poster = `${m.tmdb}.jpg`) => {
    if (/[а-яё]/i.test(f.t ?? '')) m.titleRu = f.t
    if (f.o) m.overview = f.o
    if (f.r) m.runtime = f.r
    if (f.g?.length) m.genres = f.g
    m.votes = f.vc
    if (f.tg) m.tagline = f.tg
    if (f.rd) m.released = f.rd
    if (f.c?.length) m.countries = f.c
    if (f.b) m.budget = f.b
    if (f.rev) m.revenue = f.rev
    if (f.cast?.length) m.cast = f.cast
    if (f.dir?.length) m.directors = f.dir
    if (f.col) m.series = f.col
    if (f.kw?.length) m.kw = f.kw
    if (posters.has(poster)) m.poster = poster
  }

  const posOfTmdb = new Map()
  let offset = 0, matched = 0
  catalog.forEach((m, i) => {
    const f = films[m.tmdb]
    if (!f || f.missing) return
    posOfTmdb.set(m.tmdb, i)
    enrich(m, f)
    if (f.vc >= 50) { offset += m.mean - f.va; matched++ }
  })
  // Средние TMDB сидят ниже средних MovieLens; сдвигаем дополнения на шкалу каталога.
  if (matched) offset /= matched

  const known = extras.map((id) => films[id]).filter((f) => f?.vc)
  const prior = known.reduce((a, f) => a + f.va, 0) / (known.length || 1)

  for (const id of extras) {
    const f = films[id]
    // числился дополнением, пока каталог не вырос и не включил его
    if (posOfTmdb.has(id)) {
      movedIds.set(EXTRA_ID + id, movies[posOfTmdb.get(id)].id)
      continue
    }
    if (!f || f.missing || !f.vc || !(f.t || f.ot)) continue
    const damped = (f.va * f.vc + prior * DAMP_VOTES) / (f.vc + DAMP_VOTES)
    const m = {
      id: EXTRA_ID + id,
      title: f.ot || f.t,
      year: f.y,
      genres: [],
      imdb: f.im,
      tmdb: id,
      mean: Math.round(Math.max(1, Math.min(10, damped + offset)) * 100) / 100,
    }
    enrich(m, f)
    if (wikidata[m.id]?.kp) m.kp = wikidata[m.id].kp
    posOfTmdb.set(id, movies.length)
    movies.push(m)
  }
  for (const id of extras) {
    const pos = posOfTmdb.get(id)
    if (pos === undefined || pos < N) continue
    const list = []
    films[id].recs?.forEach((rec, rank) => {
      const p = posOfTmdb.get(rec)
      if (p !== undefined) list.push([p, Math.max(0.2, 0.6 - 0.02 * rank)])
    })
    if (list.length) neighbours.set(pos, list)
  }

  // Сериалы: прогноз как у дополнений, с соседями «сериал-сериал». Их средние TMDB выше фильмовых,
  // поэтому сдвигаем их на общую с фильмами базовую линию.
  const tvKnown = tvIds.map((id) => tv[id]).filter((f) => f?.vc)
  const tvPrior = tvKnown.reduce((a, f) => a + f.va, 0) / (tvKnown.length || 1)
  const posOfTv = new Map()
  for (const id of tvIds) {
    const f = tv[id]
    if (!f || f.missing || !f.vc || !(f.t || f.ot)) continue
    const damped = (f.va * f.vc + tvPrior * DAMP_VOTES) / (f.vc + DAMP_VOTES)
    const m = {
      id: TV_ID + id,
      kind: 'tv',
      title: f.ot || f.t,
      year: f.y,
      genres: [],
      imdb: f.im,
      tmdb: id,
      mean: Math.round(Math.max(1, Math.min(10, damped - tvPrior + prior + offset)) * 100) / 100,
    }
    enrich(m, f, `tv-${id}.jpg`)
    m.genres = [...new Set(m.genres.flatMap((g) => TV_GENRES[g.toLowerCase()] ?? [g]))]
    if (f.se) m.seasons = f.se
    if (f.ep) m.episodes = f.ep
    if (f.st) m.status = f.st
    if (wikidata[m.id]?.kp) m.kp = wikidata[m.id].kp
    posOfTv.set(id, movies.length)
    movies.push(m)
  }
  for (const [id, pos] of posOfTv) {
    const list = []
    tv[id].recs?.forEach((rec, rank) => {
      const p = posOfTv.get(rec)
      if (p !== undefined) list.push([p, Math.max(0.2, 0.6 - 0.02 * rank)])
    })
    if (list.length) neighbours.set(pos, list)
  }

  // Сначала самые оценённые; у фильмов, которых нет в TMDB, грубый эквивалент из числа оценок MovieLens.
  const pop = (m) => m.votes ?? m.n * 0.3
  surveyOrder = [...movies].sort((a, b) => pop(b) - pop(a))
}

const kindOf = (m) => m.kind ?? 'movie'
const isShort = (m) => kindOf(m) === 'movie' && m.runtime && m.runtime < MIN_RUNTIME

// Один фильм встречается дважды (одно название и год): менее оценённая копия не предлагается.
const dupes = new Set()
{
  const best = new Map()
  for (const m of movies) {
    const key = `${kindOf(m)}|${(m.titleRu ?? m.title).toLowerCase()}|${m.year}`
    const b = best.get(key)
    if (!b) best.set(key, m)
    else if ((m.votes ?? 0) > (b.votes ?? 0)) { dupes.add(b.id); best.set(key, m) }
    else dupes.add(m.id)
  }
}

// id фильма -> id предыдущей части его серии, по дате выхода
const prevPart = new Map()
{
  const series = new Map()
  for (const m of movies) {
    if (!m.series || isShort(m) || dupes.has(m.id)) continue
    if (!series.has(m.series)) series.set(m.series, [])
    series.get(m.series).push(m)
  }
  const date = (m) => m.released ?? String(m.year ?? '')
  for (const parts of series.values()) {
    parts.sort((a, b) => date(a).localeCompare(date(b)))
    for (let k = 1; k < parts.length; k++) prevPart.set(parts[k].id, parts[k - 1].id)
  }
}

const hidden = (m) =>
  m.genres.some((g) => HIDDEN_GENRES.has(g.toLowerCase())) || isShort(m) || dupes.has(m.id) || (kindOf(m) === 'movie' && HIDDEN_TMDB.has(m.tmdb))

const isRecent = (m) => {
  const cutoff = new Date(Date.now() - RECENT_DAYS * 86400_000)
  return m.released ? m.released >= cutoff.toISOString().slice(0, 10) : m.year >= cutoff.getFullYear() + 1
}

// Жанры, которые пользователь может заблокировать: только русские, от 30 фильмов, по убыванию числа фильмов.
export const genreList = (() => {
  const count = new Map()
  for (const m of movies) for (const g of m.genres) count.set(g, (count.get(g) ?? 0) + 1)
  return [...count].filter(([g, c]) => c >= 30 && /[а-яё]/i.test(g)).sort((a, b) => b[1] - a[1]).map(([g]) => g)
})()

export const byId = new Map(movies.map((m) => [m.id, m]))
const posOf = new Map(movies.map((m, i) => [m.id, i]))
export const positionOf = (id) => posOf.get(id)

// Всё, что нужно прогнозу о пользователе, считается один раз из его ответов.
// P переопределяет PARAMS (так scripts/backtest.mjs сравнивает настройки).
export function profile(entries, P = PARAMS) {
  const rated = [], implicit = []
  for (const [id, e] of Object.entries(entries)) {
    const j = posOf.get(Number(id))
    if (j === undefined) continue
    if (e.seen && e.rating) rated.push([j, e.rating])
    else if (e.progress === 'dropped') implicit.push([j, IMPLICIT.seenNo])
    else if (e.progress) implicit.push([j, IMPLICIT.yes])
    else if (e.wish === 'no') implicit.push([j, e.seen ? IMPLICIT.seenNo : IMPLICIT.unseenNo])
    else if (e.wish === 'yes') implicit.push([j, IMPLICIT.yes])
  }
  // смещение: насколько в целом пользователь оценивает выше или ниже среднего
  let bias = 0
  for (const [j, r] of rated) bias += r - movies[j].mean
  if (rated.length) bias /= rated.length

  // сигналы: [позиция, отклонение от ожидаемой оценки пользователя, вес]
  const signals = rated.map(([j, r]) => [j, r - movies[j].mean - bias, 1])
  if (P.implicit > 0) for (const [j, dev] of implicit) signals.push([j, dev, P.implicit])

  const pr = { bias, cf: [], devAt: new Map(), genres: new Map(), people: new Map(), keywords: new Map(), liked: new Map(rated.filter(([, r]) => r >= 7)) }
  const add = (map, key, dev, w) => {
    const t = map.get(key)
    if (t) { t[0] += dev * w; t[1] += w } else map.set(key, [dev * w, w])
  }
  for (const [j, dev, w] of signals) {
    const m = movies[j]
    pr.devAt.set(j, [dev, w])
    if (j < N) pr.cf.push([j, dev, w])
    // Близость жанров и людей считается только по настоящим оценкам: сотни ответов «не хочу» заглушили бы её.
    if (w < 1) continue
    for (const g of m.genres) add(pr.genres, g, dev, w)
    for (const name of m.directors ?? []) add(pr.people, name, dev, w)
    for (const name of (m.cast ?? []).slice(0, CAST_DEPTH)) add(pr.people, name, dev, w)
    for (const k of m.kw ?? []) add(pr.keywords, k, dev, w)
  }
  // Плоские копии коллаборативных сигналов для горячего цикла в score().
  pr.cfJ = Int32Array.from(pr.cf, (x) => x[0])
  pr.cfDev = Float32Array.from(pr.cf, (x) => x[1])
  pr.cfW = Float32Array.from(pr.cf, (x) => x[2] / 127)
  return pr
}

// Коллаборативная часть для всех фильмов каталога разом. Обход матрицы схожести по строкам
// (по строке на оценённый фильм) идёт последовательно по памяти; в score() пришлось бы прыгать
// по строкам для каждого из N фильмов и тратить большую часть времени на промахи кэша.
function precomputeCF(pr, P) {
  const K = P.k
  const { cfJ, cfDev, cfW } = pr
  const topW = new Float32Array(N * K), topD = new Float32Array(N * K), topC = new Int32Array(N * K)
  const cnt = new Uint8Array(N)
  for (let c = 0; c < cfJ.length; c++) {
    const j = cfJ[c], w0 = cfW[c], d = cfDev[c], row = j * N
    for (let i = 0; i < N; i++) {
      const s = sim[row + i]
      if (s <= 0 || i === j) continue
      const w = s * w0, base = i * K, k = cnt[i]
      if (k < K) { topW[base + k] = w; topD[base + k] = d; topC[base + k] = c; cnt[i] = k + 1; continue }
      // Куча заполнена: новый сосед вытесняет самого слабого; среди равных слабейших уходит
      // последний пришедший — тот же tie-break, что в per-film ветке score(), поэтому числа совпадают.
      let mi = 0, mv = topW[base], mc = topC[base]
      for (let q = 1; q < K; q++) {
        const v = topW[base + q]
        if (v < mv || (v === mv && topC[base + q] > mc)) { mv = v; mi = q; mc = topC[base + q] }
      }
      if (w > mv) { topW[base + mi] = w; topD[base + mi] = d; topC[base + mi] = c }
    }
  }
  pr.cfNum = new Float32Array(N)
  pr.cfDen = new Float32Array(N)
  pr.cfHits = new Uint8Array(N)
  for (let i = 0; i < N; i++) {
    const base = i * K
    let num = 0, den = 0, hits = 0
    for (let q = 0; q < cnt[i]; q++) { num += topW[base + q] * topD[base + q]; den += topW[base + q]; if (topW[base + q] >= 0.1) hits++ }
    pr.cfNum[i] = num; pr.cfDen[i] = den; pr.cfHits[i] = hits
  }
}

// Буферы score() для весов и отклонений соседей текущего фильма.
let bufW = new Float32Array(1024), bufD = new Float32Array(1024), bufS = new Float32Array(1024)
// Сколько сигналов было у последнего вызова score(): похожие оценённые фильмы плюс знакомые режиссёры и актёры.
let evidence = 0
// Прогноз оценки 1..10 фильма в позиции i для профилированного пользователя.
export function score(pr, i, P = PARAMS) {
  const m = movies[i]
  let num = 0, den = P.reg, hits = 0
  if (i < N && pr.cfNum) {
    num += pr.cfNum[i]; den += pr.cfDen[i]; hits += pr.cfHits[i]
  } else if (i < N) {
    const { cfJ, cfDev, cfW } = pr
    if (cfJ.length > bufW.length) { bufW = new Float32Array(cfJ.length * 2); bufD = new Float32Array(cfJ.length * 2); bufS = new Float32Array(cfJ.length * 2) }
    const row = i * N
    let n = 0
    for (let c = 0; c < cfJ.length; c++) {
      const s = sim[row + cfJ[c]]
      if (s > 0 && cfJ[c] !== i) { bufW[n] = s * cfW[c]; bufD[n] = cfDev[c]; n++ }
    }
    // учитываются только k самых сильных соседей
    let min = 0
    if (n > P.k) {
      const sorted = bufS.subarray(0, n)
      sorted.set(bufW.subarray(0, n))
      sorted.sort() // по возрастанию
      min = sorted[n - P.k]
    }
    // всё выше порога плюс первые совпавшие на пороге, чтобы набрать k
    let ties = P.k
    for (let c = 0; c < n; c++) if (bufW[c] > min) ties--
    for (let c = 0; c < n; c++) {
      const w = bufW[c]
      if (w < min || (w === min && ties-- <= 0)) continue
      num += w * bufD[c]; den += w
      if (w >= 0.1) hits++
    }
  } else {
    for (const [p, w0] of neighbours.get(i) ?? []) {
      const t = pr.devAt.get(p)
      if (t) { num += w0 * t[1] * t[0]; den += w0 * t[1]; hits++ }
    }
  }
  // Близость жанров и людей работает как слабые дополнительные соседи: решает, только когда мало других данных.
  const wg = i < N ? P.genre : P.extraGenre
  if (wg > 0 && m.genres.length) {
    let g = 0
    for (const name of m.genres) {
      const t = pr.genres.get(name)
      if (t) g += t[0] / (t[1] + GENRE_SHRINK)
    }
    num += (wg * g) / m.genres.length
    den += wg
  }
  const wp = i < N ? P.people : P.extraPeople
  if (wp > 0) {
    let p = 0, known = 0
    const take = (name, weight) => {
      const t = pr.people.get(name)
      if (t) { p += (weight * t[0]) / (t[1] + PEOPLE_SHRINK); known += weight; hits++ }
    }
    for (const name of m.directors ?? []) take(name, 2)
    for (const name of (m.cast ?? []).slice(0, CAST_DEPTH)) take(name, 1)
    if (known) { num += (wp * p) / known; den += wp }
  }
  const wk = i < N ? P.keywords : P.extraKeywords
  if (wk > 0 && m.kw) {
    let k = 0, known = 0
    for (const id of m.kw) {
      const t = pr.keywords.get(id)
      if (t) { k += t[0] / (t[1] + KEYWORD_SHRINK); known++ }
    }
    if (known) { num += (wk * k) / known; den += wk; if (known >= 3) hits++ }
  }
  evidence = hits
  return Math.max(1, Math.min(10, m.mean + pr.bias + num / den))
}

function predict(entries) {
  const pr = profile(entries)
  precomputeCF(pr, PARAMS)
  const preds = new Float32Array(movies.length)
  const support = new Float32Array(movies.length)
  for (let i = 0; i < movies.length; i++) {
    preds[i] = score(pr, i)
    support[i] = evidence
  }
  return { preds, support, bias: pr.bias, liked: pr.liked }
}

export const predictAll = (entries) => predict(entries).preds

// Насколько фильм склонен делить зрителей: z-score разброса его оценок у пользователей MovieLens (0, если неизвестно).
const divisive = (() => {
  const sds = movies.filter((m) => m.sd).map((m) => m.sd)
  const mean = sds.reduce((a, b) => a + b, 0) / (sds.length || 1)
  const dev = Math.sqrt(sds.reduce((a, b) => a + (b - mean) ** 2, 0) / (sds.length || 1)) || 1
  return (m) => (m.sd ? (m.sd - mean) / dev : 0)
})()

// Следующие фильмы опроса: сначала популярные, но те, что пользователю, скорее всего, понравятся,
// поднимаются выше, похожие на отвергнутые опускаются на дно пула, а спорные идут чуть раньше —
// один ответ о них говорит о вкусе больше.
export function surveyQueue(entries, limit, blockGenres = [], kind = 'movie') {
  const { preds, bias } = predict(entries)
  const pool = []
  for (const m of surveyOrder) {
    if (kindOf(m) !== kind || m.id in entries || hidden(m) || m.genres.some((g) => blockGenres.includes(g))) continue
    const pos = posOf.get(m.id)
    pool.push([m, pool.length - SURVEY_TASTE * (preds[pos] - m.mean - bias) - SURVEY_INFO * divisive(m)])
    if (pool.length >= SURVEY_POOL) break
  }
  return pool.sort((a, b) => a[1] - b[1]).slice(0, limit).map(([m]) => m)
}

// До двух высоко оценённых пользователем фильмов, больше всего похожих на фильм i.
function similarLiked(i, liked) {
  const out = []
  if (i < N) {
    for (const [j, r] of liked) {
      if (j >= N) continue
      const s = sim[i * N + j]
      if (s >= 20) out.push([j, s * r])
    }
  } else {
    for (const [p, w] of neighbours.get(i) ?? []) if (liked.has(p)) out.push([p, w * liked.get(p)])
  }
  return out.sort((a, b) => b[1] - a[1]).slice(0, 2).map(([j]) => j)
}

// Совместные списки группы:
//   fresh — никто не видел; recent — часть fresh за последние два года;
//   show — кто-то видел и покажет остальным; rewatch — видели все;
//   plans — кто-то это смотрит или планирует.
// users: [{ id, entries, blockGenres?, snooze? }]
export function recommend(users, { kind = 'movie', freshLimit = 40 } = {}) {
  const U = users.map((u) => ({ ...u, ...predict(u.entries) }))
  const blocked = new Set(U.flatMap((u) => u.blockGenres ?? []))
  const now = Date.now()
  const fresh = [], show = [], rewatch = [], plans = []
  for (let i = 0; i < movies.length; i++) {
    if (kindOf(movies[i]) !== kind) continue
    const id = movies[i].id
    const es = U.map((u) => u.entries[id])
    if (es.some((e) => e?.wish === 'no' || e?.progress === 'dropped')) continue
    if (movies[i].genres.some((g) => blocked.has(g))) continue
    if (U.some((u) => u.snooze?.[id] > now)) continue
    const per = {}
    const scores = U.map((u, k) => {
      const e = es[k]
      const pred = Math.round(u.preds[i] * 10) / 10
      per[u.id] = {
        pred,
        low: u.support[i] < LOW_EVIDENCE,
        seen: !!e?.seen,
        rating: e?.rating ?? null,
        wish: e?.wish ?? null,
        forgot: !!e?.forgot,
        progress: e?.progress ?? null,
        season: e?.season ?? null,
      }
      return e?.seen && e.rating ? e.rating : pred
    })
    const base = 0.6 * Math.min(...scores) + 0.4 * (scores.reduce((a, b) => a + b, 0) / scores.length)
    const going = es.filter((e) => e?.progress)
    if (going.length) {
      // «смотрю» идёт раньше просто «собирались»
      plans.push({ i, movie: movies[i], score: base + (going.some((e) => e.progress === 'watching') ? 3 : 0) + 0.75 * going.length, per })
      continue
    }
    const seen = es.filter((e) => e?.seen)
    if (!seen.length) {
      const wants = es.filter((e) => e?.wish === 'yes').length
      if (!wants && hidden(movies[i])) continue
      // продолжение ждёт, пока все не посмотрят предыдущую часть
      const prev = prevPart.get(id)
      if (!wants && prev !== undefined && U.some((u) => !u.entries[prev]?.seen)) continue
      fresh.push({ i, movie: movies[i], score: base + 0.75 * wants, per })
    } else {
      // каждый, кто видел фильм, должен быть не против пересмотра: сам попросил, оценил высоко или не помнит
      if (!seen.every((e) => e.wish === 'yes' || e.forgot || e.rating >= 8)) continue
      const wants = seen.filter((e) => e.wish === 'yes').length
      const list = seen.length === U.length ? rewatch : show
      list.push({ i, movie: movies[i], score: base + 0.75 * wants, per })
    }
  }
  // «почему»: высоко оценённые фильмы, похожие на рекомендованный, и кто их любит
  const why = (i) => {
    const by = new Map()
    for (const u of U) for (const j of similarLiked(i, u.liked)) by.set(j, [...(by.get(j) ?? []), u.id])
    return [...by].slice(0, 3).map(([j, ids]) => ({ title: movies[j].titleRu ?? movies[j].title, users: ids }))
  }
  const top = (list, k) =>
    list
      .sort((a, b) => b.score - a.score)
      .slice(0, k)
      .map(({ i, ...x }) => ({ ...x, score: Math.round(x.score * 10) / 10, why: why(i) }))
  const recent = fresh.filter((x) => isRecent(x.movie))
  return { fresh: top(fresh, freshLimit), recent: top(recent, 40), show: top(show, 30), rewatch: top(rewatch, 30), plans: top(plans, 60) }
}

// Вкус одного пользователя в цифрах: что он оценивает выше всего по жанрам, режиссёрам, актёрам и десятилетиям.
export function stats(entries) {
  const rated = []
  const out = { films: 0, series: 0, want: 0, no: 0, histogram: Array(10).fill(0) }
  for (const [id, e] of Object.entries(entries)) {
    const m = byId.get(Number(id))
    if (!m) continue
    if (e.seen) out[kindOf(m) === 'tv' ? 'series' : 'films']++
    else if (e.wish === 'yes' || e.progress === 'planned') out.want++
    else if (e.wish === 'no') out.no++
    if (e.rating) { rated.push([m, e.rating]); out.histogram[e.rating - 1]++ }
  }
  const mean = rated.reduce((s, [, r]) => s + r, 0) / (rated.length || 1)
  // Ранжировано по средней с небольшим притяжением к собственной средней пользователя:
  // одна случайная 10 не взлетит на вершину списка.
  const group = (keys, min) => {
    const by = new Map()
    for (const [m, r] of rated) for (const k of keys(m)) { const t = by.get(k) ?? by.set(k, [0, 0]).get(k); t[0] += r; t[1]++ }
    return [...by]
      .filter(([, [, c]]) => c >= min)
      .map(([name, [sum, count]]) => ({ name, avg: Math.round((sum / count) * 10) / 10, count, rank: (sum + mean * 2) / (count + 2) }))
      .sort((a, b) => b.rank - a.rank)
      .map(({ rank, ...x }) => x)
  }
  return {
    ...out,
    rated: rated.length,
    mean: Math.round(mean * 10) / 10,
    genres: group((m) => m.genres, 5),
    directors: group((m) => (kindOf(m) === 'tv' ? [] : m.directors ?? []), 3).slice(0, 10),
    actors: group((m) => (m.cast ?? []).slice(0, CAST_DEPTH), 4).slice(0, 10),
    decades: group((m) => (m.year ? [`${Math.floor(m.year / 10) * 10}-е`] : []), 3).sort((a, b) => a.name.localeCompare(b.name)),
  }
}

// Насколько близки вкусы двоих — по фильмам, которые оценили оба. Сравниваются относительно
// личной планки каждого, поэтому строгий оценщик не выглядит несогласным со всем подряд.
export function compatibility(a, b) {
  const both = []
  const wantBoth = []
  for (const [id, ea] of Object.entries(a)) {
    const eb = b[id]
    const movie = byId.get(Number(id))
    if (!movie || !eb) continue
    if (ea.rating && eb.rating) both.push({ movie, ratings: [ea.rating, eb.rating] })
    else if (!ea.seen && !eb.seen && ea.wish === 'yes' && eb.wish === 'yes') wantBoth.push(movie)
  }
  if (both.length < 5) return { common: both.length, percent: null, loved: [], split: [], wantBoth }
  const mean = (k) => both.reduce((s, x) => s + x.ratings[k], 0) / both.length
  const ma = mean(0), mb = mean(1)
  for (const x of both) x.gap = Math.abs(x.ratings[0] - ma - (x.ratings[1] - mb))
  const avgGap = both.reduce((s, x) => s + x.gap, 0) / both.length
  const strip = ({ movie, ratings }) => ({ movie, ratings })
  return {
    common: both.length,
    percent: Math.round(Math.max(0, 100 - 22 * avgGap)),
    loved: both.filter((x) => x.ratings[0] >= 8 && x.ratings[1] >= 8).sort((x, y) => y.ratings[0] + y.ratings[1] - x.ratings[0] - x.ratings[1]).slice(0, 10).map(strip),
    split: [...both].sort((x, y) => y.gap - x.gap).slice(0, 10).map(strip),
    wantBoth: wantBoth.slice(0, 20),
  }
}
