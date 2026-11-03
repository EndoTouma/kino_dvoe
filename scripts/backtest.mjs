// Насколько промахиваются прогнозы? Каждую оценку пользователя прячем, предсказываем по остальным
// и сравниваем. Печатает среднюю абсолютную ошибку (в баллах) по каждому пользователю рядом
// с двумя наивными базовыми линиями:
//   «среднее пользователя» — всегда предсказывать собственную среднюю оценку
//   «среднее фильма» — среднюю оценку фильма, сдвинутую на строгость пользователя
// Только чтение: берёт data/db.json (или KINO_DB) и модель, ничего не меняет.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { movies, positionOf, profile, score } from '../server/recommender.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const db = JSON.parse(fs.readFileSync(process.env.KINO_DB ?? path.join(ROOT, 'data/db.json'), 'utf8'))

const avg = (xs) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1)
const fmt = (x) => x.toFixed(2)

for (const user of db.users) {
  const entries = db.entries[user.id] ?? {}
  const rated = Object.entries(entries).filter(([id, e]) => e.rating && positionOf(Number(id)) !== undefined)
  if (rated.length < 10) {
    console.log(`${user.name}: мало оценок (${rated.length})`)
    continue
  }
  const rows = []
  for (const [id, e] of rated) {
    const { [id]: _, ...rest } = entries
    const others = Object.entries(rest).filter(([, x]) => x.rating)
    const pos = positionOf(Number(id))
    const userMean = avg(others.map(([, x]) => x.rating))
    const pr = profile(rest)
    const pred = score(pr, pos)
    rows.push({
      kind: movies[pos].kind === 'tv' ? 'сериалы' : movies[pos].n ? 'фильмы с данными MovieLens' : 'фильмы только из TMDB',
      model: Math.abs(pred - e.rating),
      userMean: Math.abs(userMean - e.rating),
      filmMean: Math.abs(Math.max(1, Math.min(10, movies[pos].mean + pr.bias)) - e.rating),
      // попал ли прогноз на верную сторону от средней оценки пользователя?
      side: (pred - userMean) * (e.rating - userMean) > 0,
    })
  }
  console.log(`\n${user.name}: оценок ${rated.length}, проверено ${rows.length}`)
  const report = (label, list) => {
    if (!list.length) return
    console.log(
      `  ${label.padEnd(28)} n=${String(list.length).padEnd(4)} модель ${fmt(avg(list.map((r) => r.model)))} | среднее по фильму ${fmt(avg(list.map((r) => r.filmMean)))} | среднее пользователя ${fmt(avg(list.map((r) => r.userMean)))} | верная сторона ${Math.round(100 * avg(list.map((r) => (r.side ? 1 : 0))))}%`,
    )
  }
  report('все', rows)
  for (const kind of new Set(rows.map((r) => r.kind))) report(kind, rows.filter((r) => r.kind === kind))
}
