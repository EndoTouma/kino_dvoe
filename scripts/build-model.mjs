// Собирает модель рекомендаций из дампа MovieLens в data/raw/ml-32m:
//   data/model/catalog.json — топ-N фильмов в том порядке, в котором их показывает опрос
//   data/model/sim.bin      — N×N схожесть фильм-фильм, Int8 (значение / 127)
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const RAW = path.join(ROOT, 'data/raw/ml-32m')
const OUT = process.env.KINO_MODEL ?? path.join(ROOT, 'data/model')

const N = Number(process.env.KINO_N ?? 4000) // размер каталога
const SAMPLE = Number(process.env.KINO_SAMPLE ?? 4) // брать каждого SAMPLE-го пользователя
const SHRINK = 50 // притяжение схожести к 0 у редко совместно оценённых пар
const DAMP = 25 // демпфирование средней оценки фильма к общей средней

// Посимвольное чтение ratings.csv (userId,movieId,rating,timestamp): readline слишком медленна для 32 млн строк.
async function scanRatings(onRating) {
  let header = true, field = 0, u = 0, m = 0, r = 0, div = 0
  for await (const buf of fs.createReadStream(path.join(RAW, 'ratings.csv'), { highWaterMark: 1 << 22 })) {
    for (let k = 0; k < buf.length; k++) {
      const c = buf[k]
      if (c === 10) {
        if (!header) onRating(u, m, r)
        header = false; field = 0; u = 0; m = 0; r = 0; div = 0
      } else if (header || c === 13) {
        continue
      } else if (c === 44) {
        field++
      } else if (field === 0) {
        u = u * 10 + c - 48
      } else if (field === 1) {
        m = m * 10 + c - 48
      } else if (field === 2) {
        if (c === 46) div = 1
        else if (div) { div *= 10; r += (c - 48) / div }
        else r = r * 10 + c - 48
      }
    }
  }
  if (!header && field >= 2) onRating(u, m, r)
}

function parseTitle(raw) {
  let title = raw.trim()
  let year = null
  const y = title.match(/\((\d{4})\)$/)
  if (y) { year = Number(y[1]); title = title.slice(0, y.index).trim() }
  const art = title.match(/^(.*), (The|A|An)$/)
  if (art) title = `${art[2]} ${art[1]}`
  return { title, year }
}

console.time('проход 1: популярность')
const cnt = new Map(), sum = new Map(), sumSq = new Map()
let total = 0, totalSum = 0
await scanRatings((u, m, r) => {
  cnt.set(m, (cnt.get(m) ?? 0) + 1)
  sum.set(m, (sum.get(m) ?? 0) + r)
  sumSq.set(m, (sumSq.get(m) ?? 0) + r * r)
  total++; totalSum += r
})
console.timeEnd('проход 1: популярность')
const globalMean = totalSum / total

const movies = new Map()
for (const line of fs.readFileSync(path.join(RAW, 'movies.csv'), 'utf8').split(/\r?\n/).slice(1)) {
  const m = line.match(/^(\d+),(?:"((?:[^"]|"")*)"|([^,]*)),(.*)$/)
  if (!m) continue
  const { title, year } = parseTitle((m[2] ?? m[3]).replaceAll('""', '"'))
  const genres = m[4] === '(no genres listed)' ? [] : m[4].split('|')
  movies.set(Number(m[1]), { title, year, genres })
}
const links = new Map()
for (const line of fs.readFileSync(path.join(RAW, 'links.csv'), 'utf8').split(/\r?\n/).slice(1)) {
  const [id, imdb, tmdb] = line.split(',')
  if (id) links.set(Number(id), { imdb: imdb ? 'tt' + imdb.padStart(7, '0') : null, tmdb: tmdb ? Number(tmdb) : null })
}

// Порядок опроса: сначала самые оценённые, с уклоном в новые фильмы (MovieLens перекошен в сторону 90-х).
const tilt = (id) => cnt.get(id) * ((movies.get(id)?.year ?? 0) >= 2000 ? 1.5 : 1)
const top = [...cnt.keys()].filter((id) => movies.has(id)).sort((a, b) => cnt.get(b) - cnt.get(a)).slice(0, N)
top.sort((a, b) => tilt(b) - tilt(a))
const n = top.length
const idxOf = new Map(top.map((id, i) => [id, i]))

console.time('проход 2: совместные оценки')
// Верхний треугольник dot держит Σ vi·vj, нижний — число совместных оценок;
// sq[i*n+j] держит Σ vi² по пользователям, оценившим и i, и j.
const dot = new Float32Array(n * n)
const sq = new Float32Array(n * n)
let curUser = -1, ids = [], vals = [], usersUsed = 0
function flush() {
  const k = ids.length
  if (k < 5 || k > 2000) return
  let mean = 0
  for (let a = 0; a < k; a++) mean += vals[a]
  mean /= k
  const order = Array.from({ length: k }, (_, a) => a).sort((a, b) => ids[a] - ids[b])
  const I = order.map((a) => ids[a]), V = order.map((a) => vals[a] - mean)
  for (let a = 0; a < k; a++) {
    const i = I[a], vi = V[a], row = i * n
    for (let b = a + 1; b < k; b++) {
      const j = I[b], vj = V[b]
      dot[row + j] += vi * vj
      dot[j * n + i] += 1
      sq[row + j] += vi * vi
      sq[j * n + i] += vj * vj
    }
  }
  usersUsed++
}
await scanRatings((u, m, r) => {
  if (u !== curUser) { flush(); curUser = u; ids = []; vals = [] }
  if (u % SAMPLE !== 0) return
  const i = idxOf.get(m)
  if (i !== undefined) { ids.push(i); vals.push(r) }
})
flush()
console.timeEnd('проход 2: совместные оценки')

const sim = new Int8Array(n * n)
for (let i = 0; i < n; i++) {
  for (let j = i + 1; j < n; j++) {
    const c = dot[j * n + i]
    const den = Math.sqrt(sq[i * n + j] * sq[j * n + i])
    if (c < 2 || den === 0) continue
    const s = (dot[i * n + j] / den) * (c / (c + SHRINK))
    const q = Math.max(-127, Math.min(127, Math.round(s * 127)))
    sim[i * n + j] = q
    sim[j * n + i] = q
  }
}

const catalog = top.map((id) => {
  const c = cnt.get(id)
  return {
    id,
    ...movies.get(id),
    ...links.get(id),
    n: c,
    // демпфированная средняя в шкале приложения 1..10
    mean: Math.round(((sum.get(id) + DAMP * globalMean) / (c + DAMP)) * 2 * 100) / 100,
    // разброс оценок в шкале 1..10: высокий у фильмов, в оценках которых зрители расходятся
    sd: Math.round(Math.sqrt(Math.max(0, sumSq.get(id) / c - (sum.get(id) / c) ** 2)) * 2 * 100) / 100,
  }
})

fs.mkdirSync(OUT, { recursive: true })
fs.writeFileSync(path.join(OUT, 'catalog.json'), JSON.stringify(catalog))
fs.writeFileSync(path.join(OUT, 'sim.bin'), Buffer.from(sim.buffer))
console.log(`catalog: ${n} films, users used: ${usersUsed}, global mean: ${(globalMean * 2).toFixed(2)}/10`)
