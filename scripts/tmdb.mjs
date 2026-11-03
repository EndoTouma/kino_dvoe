// Тянет данные из TMDB в data/model/tmdb.json, а постеры — в data/posters:
//   - русское название, описание, жанры, длительность, постер, дата выхода, страны, бюджет, актёры для каждого фильма каталога
//   - дополнительные фильмы, которых нет в каталоге MovieLens (всё с достаточным числом голосов, включая релизы 2023+)
//   - сериалы с достаточным числом голосов
// Ключ читается из data/tmdb.key (v3 key или v4 read token) и никуда не печатается.
// Повторный запуск докачивает пропущенное: скачанное пропускается; TMDB_REFRESH=1 перечитывает данные фильмов,
// TMDB_DISCOVER=1 повторяет поиск новых фильмов (стоит делать время от времени, чтобы подхватить свежие релизы).
import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const KEY_FILE = path.join(ROOT, 'data/tmdb.key')
const OUT = path.join(ROOT, 'data/model/tmdb.json')
const POSTERS = path.join(ROOT, 'data/posters')

const MIN_VOTES = Number(process.env.TMDB_MIN_VOTES ?? 300)
const MIN_VOTES_RECENT = Number(process.env.TMDB_MIN_VOTES_RECENT ?? 80) // релизы последних 3 лет
const TV_MIN_VOTES = Number(process.env.TMDB_TV_MIN_VOTES ?? 150)
const TV_MIN_VOTES_RECENT = Number(process.env.TMDB_TV_MIN_VOTES_RECENT ?? 40)
const CONCURRENCY = 5
const ATTEMPTS = 8
const VERSION = 4 // поднимать, когда формат записи фильма меняется, чтобы старые перечитались

const key = (fs.existsSync(KEY_FILE) ? fs.readFileSync(KEY_FILE, 'utf8') : process.env.TMDB_KEY ?? '').trim()
if (!key) {
  console.error('Нет ключа: положите ключ TMDB в файл data/tmdb.key')
  process.exit(1)
}
const bearer = key.length > 40

// Умолчальные 250 мс на адрес для медленного канала (VPN) коротки: каждый адрес бросается раньше,
// чем соединится, и запрос умирает с ETIMEDOUT.
net.setDefaultAutoSelectFamilyAttemptTimeout(5000)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function tmdb(pathname, params = {}) {
  const url = new URL('https://api.themoviedb.org/3' + pathname)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  if (!bearer) url.searchParams.set('api_key', key)
  for (let attempt = 1; ; attempt++) {
    let res
    try {
      res = await fetch(url, { headers: bearer ? { Authorization: `Bearer ${key}` } : {}, signal: AbortSignal.timeout(20000) })
    } catch (e) {
      if (attempt >= ATTEMPTS) throw new Error(`сеть: ${pathname}: ${e.cause?.code ?? e.message}`)
      await sleep(3000 * attempt)
      continue
    }
    if (res.ok) return res.json()
    if (res.status === 404) return null
    if (res.status === 401) {
      console.error('TMDB отклонил ключ (401) — проверьте data/tmdb.key')
      process.exit(1)
    }
    if (attempt >= ATTEMPTS) throw new Error(`TMDB ${res.status}: ${pathname}`)
    await sleep((Number(res.headers.get('retry-after')) || 2 * attempt) * 1000)
  }
}

async function pool(items, fn) {
  let next = 0
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    while (next < items.length) await fn(items[next++])
  }))
}

const catalog = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/model/catalog.json'), 'utf8'))
const inCatalog = new Set(catalog.map((m) => m.tmdb).filter(Boolean))
// films: { [tmdbId]: запись }, extras: id фильмов вне каталога MovieLens,
// tv: { [tmdbId]: запись }, tvIds: id сериалов
const db = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : { films: {}, extras: [] }
db.tv ??= {}
db.tvIds ??= []
if (process.env.TMDB_REFRESH) { db.films = {}; db.tv = {} }
const saveDb = () => {
  fs.writeFileSync(OUT + '.tmp', JSON.stringify(db))
  fs.renameSync(OUT + '.tmp', OUT)
}

const thisYear = new Date().getFullYear()
const startedAt = Date.now()
// Запись перечитывается, когда устарел её формат, или когда это свежий релиз,
// чьи голоса и рейтинг ещё двигаются, а скачана она больше месяца назад.
const stale = (f) => !(f?.v >= VERSION) || (!f.missing && f.y >= thisYear - 1 && !(f.at > startedAt - 30 * 86400_000))

// id всего с достаточным числом голосов, год за годом (один запрос discover обрезан на 500 страниц).
async function discover(endpoint, dateField, firstYear, minVotes, minVotesRecent, onId) {
  const years = Array.from({ length: thisYear - firstYear + 1 }, (_, i) => firstYear + i)
  await pool(years, async (y) => {
    for (let page = 1; ; page++) {
      const res = await tmdb(endpoint, {
        [`${dateField}.gte`]: `${y}-01-01`,
        [`${dateField}.lte`]: `${y}-12-31`,
        'vote_count.gte': y >= thisYear - 2 ? minVotesRecent : minVotes,
        sort_by: 'vote_count.desc',
        include_adult: false,
        include_video: false,
        page,
      })
      for (const m of res.results) onId(m.id)
      if (page >= res.total_pages) break
    }
  })
}

// Подробности по-русски для каждого id, которому они нужны; дрянное соединение не должно убить весь прогон —
// сбойный элемент пропускается и догоняется следующим запуском.
async function details(label, ids, store, fetchOne) {
  const todo = ids.filter((id) => stale(store[id]))
  let done = 0, skipped = 0
  await pool(todo, async (id) => {
    let rec
    try {
      rec = await fetchOne(id)
    } catch {
      skipped++
      return
    }
    store[id] = rec ? { v: VERSION, at: startedAt, ...rec } : { v: VERSION, missing: true }
    if (++done % 500 === 0) {
      saveDb()
      console.log(`${label}: ${done}/${todo.length}`)
    }
  })
  saveDb()
  console.log(`${label}: ${done}/${todo.length}` + (skipped ? `, пропущено из-за сети: ${skipped} — запустите скрипт ещё раз, чтобы докачать` : ''))
}

// ---------- фильмы ----------
const extras = new Set(db.extras)
if (!db.extras.length || process.env.TMDB_DISCOVER) {
  await discover('/discover/movie', 'primary_release_date', 1900, MIN_VOTES, MIN_VOTES_RECENT, (id) => {
    if (!inCatalog.has(id)) extras.add(id)
  })
  db.extras = [...extras]
  saveDb()
} else console.log('поиск новых фильмов пропущен (список уже есть; TMDB_DISCOVER=1 — обновить)')
console.log(`каталог MovieLens: ${inCatalog.size}, дополнительно из TMDB: ${db.extras.length}`)

// у дополнений также забираются «похожие фильмы» TMDB — они же соседи для прогнозов
await details('фильмы', [...inCatalog, ...db.extras], db.films, async (id) => {
  const d = await tmdb(`/movie/${id}`, { language: 'ru-RU', append_to_response: extras.has(id) ? 'credits,keywords,recommendations' : 'credits,keywords' })
  return d && {
    t: d.title,
    ot: d.original_title,
    o: d.overview || undefined,
    p: d.poster_path || undefined,
    g: d.genres.map((g) => g.name),
    r: d.runtime || undefined,
    va: d.vote_average,
    vc: d.vote_count,
    y: Number(d.release_date?.slice(0, 4)) || null,
    im: d.imdb_id || undefined,
    tg: d.tagline || undefined,
    col: d.belongs_to_collection?.id,
    rd: d.release_date || undefined,
    c: d.production_countries.map((c) => c.iso_3166_1),
    b: d.budget || undefined,
    rev: d.revenue || undefined,
    cast: d.credits.cast.slice(0, 8).map((p) => p.name),
    dir: d.credits.crew.filter((p) => p.job === 'Director').map((p) => p.name),
    kw: d.keywords?.keywords.slice(0, 25).map((k) => k.id),
    recs: d.recommendations?.results.map((r) => r.id),
  }
})

// ---------- сериалы ----------
if (!db.tvIds.length || process.env.TMDB_DISCOVER) {
  const tvIds = new Set(db.tvIds)
  await discover('/discover/tv', 'first_air_date', 1950, TV_MIN_VOTES, TV_MIN_VOTES_RECENT, (id) => tvIds.add(id))
  db.tvIds = [...tvIds]
  saveDb()
}
console.log(`сериалов: ${db.tvIds.length}`)

await details('сериалы', db.tvIds, db.tv, async (id) => {
  const d = await tmdb(`/tv/${id}`, { language: 'ru-RU', append_to_response: 'credits,recommendations,external_ids,keywords' })
  return d && {
    t: d.name,
    ot: d.original_name,
    o: d.overview || undefined,
    p: d.poster_path || undefined,
    g: d.genres.map((g) => g.name),
    r: d.episode_run_time?.[0] || undefined,
    va: d.vote_average,
    vc: d.vote_count,
    y: Number(d.first_air_date?.slice(0, 4)) || null,
    im: d.external_ids?.imdb_id || undefined,
    tg: d.tagline || undefined,
    rd: d.first_air_date || undefined,
    ld: d.last_air_date || undefined,
    st: d.status || undefined,
    se: d.number_of_seasons || undefined,
    ep: d.number_of_episodes || undefined,
    c: d.origin_country ?? [],
    cast: d.credits.cast.slice(0, 8).map((p) => p.name),
    dir: (d.created_by ?? []).map((p) => p.name),
    kw: d.keywords?.results.slice(0, 25).map((k) => k.id),
    recs: d.recommendations?.results.map((r) => r.id),
  }
})

// ---------- постеры: отдаёт наш сервер, чтобы телефонам не нужен был доступ к TMDB ----------
fs.mkdirSync(POSTERS, { recursive: true })
const have = new Set(fs.readdirSync(POSTERS))
const wanted = [
  ...Object.entries(db.films).map(([id, f]) => [`${id}.jpg`, f.p]),
  ...Object.entries(db.tv).map(([id, f]) => [`tv-${id}.jpg`, f.p]),
].filter(([name, p]) => p && !have.has(name))
let saved = 0, failed = 0
await pool(wanted, async ([name, p]) => {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(`https://image.tmdb.org/t/p/w342${p}`, { signal: AbortSignal.timeout(30000) })
      if (!res.ok) throw new Error(String(res.status))
      fs.writeFileSync(path.join(POSTERS, name), Buffer.from(await res.arrayBuffer()))
      saved++
      break
    } catch {
      if (attempt === 3) failed++
      else await sleep(1000 * attempt)
    }
  }
  if ((saved + failed) % 500 === 0) console.log(`постеры: ${saved + failed}/${wanted.length}`)
})
console.log(`постеры: скачано ${saved}, не удалось ${failed}, уже было ${have.size}`)
console.log('готово — перезапустите сервер, чтобы он подхватил данные')
