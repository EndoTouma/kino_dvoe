// Достаёт русские названия и id Кинопоиска из Wikidata (сопоставление по IMDb id)
// в data/model/extra.json. Можно запускать повторно: уже скачанные фильмы пропускаются.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const MODEL = path.join(ROOT, 'data/model')
const EXTRA = path.join(MODEL, 'extra.json')
const BATCH = 150

const catalog = JSON.parse(fs.readFileSync(path.join(MODEL, 'catalog.json'), 'utf8'))
// Фильмы только из TMDB (см. scripts/tmdb.mjs) получают id 10_000_000 + tmdb id, как и на сервере
const tmdbFile = path.join(MODEL, 'tmdb.json')
if (fs.existsSync(tmdbFile)) {
  const { films, extras, tv = {}, tvIds = [] } = JSON.parse(fs.readFileSync(tmdbFile, 'utf8'))
  for (const id of extras) if (films[id]?.im) catalog.push({ id: 10_000_000 + id, imdb: films[id].im })
  // сериалы: 20_000_000 + tmdb id
  for (const id of tvIds) if (tv[id]?.im) catalog.push({ id: 20_000_000 + id, imdb: tv[id].im })
}
const extra = fs.existsSync(EXTRA) ? JSON.parse(fs.readFileSync(EXTRA, 'utf8')) : {}
const todo = catalog.filter((m) => m.imdb && !(m.id in extra))
const byImdb = new Map(todo.map((m) => [m.imdb, m.id]))

async function query(imdbIds) {
  const sparql = `SELECT ?imdb ?ru ?kp WHERE {
    VALUES ?imdb { ${imdbIds.map((i) => `"${i}"`).join(' ')} }
    ?item wdt:P345 ?imdb .
    OPTIONAL { ?item rdfs:label ?ru FILTER(LANG(?ru) = "ru") }
    OPTIONAL { ?item wdt:P2603 ?kp }
  }`
  for (let attempt = 1; ; attempt++) {
    const res = await fetch('https://query.wikidata.org/sparql', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/sparql-results+json',
        'User-Agent': 'kino-home-app/0.1 (personal, non-commercial)',
      },
      body: new URLSearchParams({ query: sparql }),
    })
    if (res.ok) return (await res.json()).results.bindings
    if (attempt >= 4) throw new Error(`Wikidata ${res.status}: ${await res.text()}`)
    await new Promise((r) => setTimeout(r, 5000 * attempt))
  }
}

for (let i = 0; i < todo.length; i += BATCH) {
  const batch = todo.slice(i, i + BATCH)
  const rows = await query(batch.map((m) => m.imdb))
  for (const m of batch) extra[m.id] = {}
  for (const row of rows) {
    const e = extra[byImdb.get(row.imdb.value)]
    if (row.ru && !e.ru) e.ru = row.ru.value
    if (row.kp && !e.kp) e.kp = Number(row.kp.value)
  }
  fs.writeFileSync(EXTRA, JSON.stringify(extra))
  console.log(`${Math.min(i + BATCH, todo.length)}/${todo.length}`)
  await new Promise((r) => setTimeout(r, 1000))
}
