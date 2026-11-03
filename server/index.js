import express from 'express'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { db, save } from './db.js'
import { POSTERS, byId, compatibility, genreList, movedIds, recommend, stats, surveyOrder, surveyQueue } from './recommender.js'

const PORT = Number(process.env.PORT ?? 3000)
const DIST = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist')
const AVATARS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../data/avatars')

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const kindParam = (v) => (v === 'tv' ? 'tv' : 'movie')

const app = express()
app.use(express.json({ limit: '1mb' }))
// Служебные поля фильма, нужные только прогнозу, в ответы браузеру не уходят
app.set('json replacer', (key, value) => (key === 'kw' ? undefined : value))
let lastRequest = Date.now()
app.use((req, res, next) => {
  lastRequest = Date.now()
  next()
})

// Разовая миграция: фильмы, которые раньше были «только из TMDB», а теперь вошли в общий каталог,
// сменили id. Ответы, журнал просмотров и «не сегодня» следуют за ними.
{
  let moved = 0
  for (const es of Object.values(db.entries)) {
    for (const [from, to] of movedIds) {
      if (!(from in es)) continue
      // если оба id были отвечены, побеждает более свежий ответ
      if (!(to in es) || es[from].t > es[to].t) es[to] = es[from]
      delete es[from]
      moved++
    }
  }
  for (const w of db.watched) if (movedIds.has(w.movieId)) w.movieId = moved.get(w.movieId)
  for (const sn of Object.values(db.snooze)) {
    for (const [from, to] of movedIds) if (from in sn) { sn[to] = sn[from]; delete sn[from] }
  }
  if (moved) {
    if (db.tonight) db.tonight = null
    console.log(`migrated ${moved} answers to new film ids`)
    save()
  }
}

const entriesOf = (userId) => (db.entries[userId] ??= {})
const movieOf = (id) => byId.get(Number(id))
// «Смотрел» без оценки просит оценку, если только сам пользователь не нажал «без оценки»
const isPending = (e) => e.seen && !e.rating && !e.unrated
const knownUsers = (ids) => (Array.isArray(ids) ? ids : String(ids ?? '').split(',')).filter((id) => db.users.some((u) => u.id === id))
const groupOf = (ids) =>
  ids.map((id) => ({
    id,
    entries: entriesOf(id),
    blockGenres: db.users.find((u) => u.id === id).blockGenres ?? [],
    snooze: db.snooze[id] ?? {},
  }))

function userParam(req, res, next) {
  const id = req.params.user ?? req.query.user
  if (!db.users.some((u) => u.id === id)) return res.status(404).json({ error: 'user not found' })
  req.userId = id
  next()
}

app.get('/api/users', (req, res) => {
  res.json(db.users.map((u) => {
    const es = Object.values(entriesOf(u.id))
    return { ...u, answered: es.length, rated: es.filter((e) => e.rating).length }
  }))
})

app.post('/api/users', (req, res) => {
  const name = String(req.body?.name ?? '').trim().slice(0, 30)
  if (!name) return res.status(400).json({ error: 'name required' })
  const user = { id: crypto.randomUUID().slice(0, 8), name }
  db.users.push(user)
  save()
  res.json(user)
})

app.patch('/api/users/:user', userParam, (req, res) => {
  const user = db.users.find((u) => u.id === req.userId)
  const { name, blockGenres } = req.body ?? {}
  if (name !== undefined) {
    const clean = String(name).trim().slice(0, 30)
    if (!clean) return res.status(400).json({ error: 'name required' })
    user.name = clean
  }
  if (Array.isArray(blockGenres)) user.blockGenres = genreList.filter((g) => blockGenres.includes(g))
  save()
  res.json(user)
})

app.get('/api/genres', (req, res) => res.json(genreList))

// Аватар приходит data URL маленького JPEG (браузер сам обрезает и ужимает фото перед отправкой)
app.put('/api/users/:user/avatar', userParam, (req, res) => {
  const m = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(req.body?.image ?? '')
  const buf = m && Buffer.from(m[1], 'base64')
  if (!buf || buf.length > 500_000 || buf[0] !== 0xff || buf[1] !== 0xd8) return res.status(400).json({ error: 'bad image' })
  fs.mkdirSync(AVATARS, { recursive: true })
  fs.writeFileSync(path.join(AVATARS, `${req.userId}.jpg`), buf)
  const user = db.users.find((u) => u.id === req.userId)
  user.avatar = Date.now() // одновременно версия для сброса кэша
  save()
  res.json(user)
})

app.delete('/api/users/:user', userParam, (req, res) => {
  fs.rmSync(path.join(AVATARS, `${req.userId}.jpg`), { force: true })
  db.users = db.users.filter((u) => u.id !== req.userId)
  delete db.entries[req.userId]
  delete db.snooze[req.userId]
  if (db.tonight?.users.includes(req.userId)) db.tonight = null
  for (const w of db.watched) w.users = w.users.filter((id) => id !== req.userId)
  db.watched = db.watched.filter((w) => w.users.length)
  save()
  res.json({ ok: true })
})

app.get('/api/survey', userParam, (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 15, 50)
  const kind = kindParam(req.query.kind)
  const es = entriesOf(req.userId)
  const movies = surveyQueue(es, limit, db.users.find((u) => u.id === req.userId).blockGenres, kind)
  // Прогресс считается отдельно для фильмов и сериалов
  const all = Object.entries(es).filter(([id]) => (movieOf(id)?.kind ?? 'movie') === kind).map(([, e]) => e)
  res.json({ movies, answered: all.length, rated: all.filter((e) => e.rating).length })
})

app.get('/api/entries', userParam, (req, res) => {
  const list = Object.entries(entriesOf(req.userId))
    .map(([id, entry]) => ({ movie: movieOf(id), entry }))
    .filter((x) => x.movie)
    .sort((a, b) => b.entry.t - a.entry.t)
  res.json(list)
})

// Фильмы, отмеченные «смотрел» без оценки — напоминание «оцените»
app.get('/api/pending', userParam, (req, res) => {
  const list = Object.entries(entriesOf(req.userId))
    .filter(([, e]) => isPending(e))
    .map(([id, entry]) => ({ movie: movieOf(id), entry }))
    .filter((x) => x.movie)
  res.json(list)
})

// Слияние-патч { seen, rating, wish }. forgot («смотрел, не помню») и progress («watching» | «dropped» | «planned»,
// с номером сезона для «watching») живут только в запросе, который их ставит.
// Ответ несёт прежнюю запись как prev — клиент может предложить отмену.
app.put('/api/entries/:user/:movie', userParam, (req, res) => {
  const movie = movieOf(req.params.movie)
  if (!movie) return res.status(404).json({ error: 'movie not found' })
  const { seen, rating, wish, forgot, progress, season } = req.body ?? {}
  if (seen !== undefined && typeof seen !== 'boolean') return res.status(400).json({ error: 'bad seen' })
  if (rating != null && !(Number.isInteger(rating) && rating >= 1 && rating <= 10)) return res.status(400).json({ error: 'bad rating' })
  if (wish != null && wish !== 'yes' && wish !== 'no') return res.status(400).json({ error: 'bad wish' })
  if (progress != null && !['watching', 'dropped', 'planned'].includes(progress)) return res.status(400).json({ error: 'bad progress' })
  if (season != null && !(Number.isInteger(season) && season >= 1 && season <= 200)) return res.status(400).json({ error: 'bad season' })
  const es = entriesOf(req.userId)
  const prev = es[movie.id] ?? null
  const e = { seen: false, ...es[movie.id] }
  if (seen !== undefined) e.seen = seen
  if (rating !== undefined) e.rating = rating
  if (wish !== undefined) e.wish = wish
  if (e.rating == null) delete e.rating
  if (e.wish == null) delete e.wish
  if (!e.seen) { delete e.rating; delete e.watchedAt }
  if (e.seen && !e.rating) e.unrated = true
  else delete e.unrated
  if (forgot === true && e.seen && !e.rating) e.forgot = true
  else delete e.forgot
  delete e.progress
  delete e.season
  if (progress && !e.seen) {
    e.progress = progress
    if (progress === 'watching' && season) e.season = season
  }
  e.t = Date.now()
  es[movie.id] = e
  save()
  res.json({ ...e, prev })
})

app.delete('/api/entries/:user/:movie', userParam, (req, res) => {
  delete entriesOf(req.userId)[req.params.movie]
  save()
  res.json({ ok: true })
})

// «Посмотрели»: отмечает фильм просмотренным у каждого из списка; у кого нет оценки — напоминание.
app.post('/api/watched', (req, res) => {
  const movie = movieOf(req.body?.movieId)
  const users = Array.isArray(req.body?.users) ? req.body.users.filter((id) => db.users.some((u) => u.id === id)) : []
  if (!movie || !users.length) return res.status(400).json({ error: 'movieId and users required' })
  const ratings = req.body.ratings ?? {}
  if (users.some((id) => ratings[id] != null && !(Number.isInteger(ratings[id]) && ratings[id] >= 1 && ratings[id] <= 10))) {
    return res.status(400).json({ error: 'bad rating' })
  }
  const now = Date.now()
  const at = new Date(now).toISOString()
  for (const id of users) {
    const es = entriesOf(id)
    const e = { ...es[movie.id], seen: true, t: now }
    e.watchedAt ??= at
    if (ratings[id] != null) e.rating = ratings[id]
    delete e.wish
    delete e.forgot
    delete e.progress
    delete e.season
    es[movie.id] = e
  }
  // журнал совместных просмотров; повторное сохранение того же фильма лишь дополняет список зрителей
  const rec = db.watched.find((w) => w.movieId === movie.id)
  if (rec) rec.users = [...new Set([...rec.users, ...users])]
  else db.watched.push({ movieId: movie.id, users, at })
  save()
  res.json({ ok: true })
})

app.get('/api/watched', (req, res) => {
  const list = db.watched
    .map((w) => ({
      movie: movieOf(w.movieId),
      at: w.at,
      users: w.users,
      ratings: Object.fromEntries(w.users.map((id) => [id, db.entries[id]?.[w.movieId]?.rating ?? null])),
    }))
    .filter((x) => x.movie)
    .sort((a, b) => b.at.localeCompare(a.at))
  res.json(list)
})

app.get('/api/recs', (req, res) => {
  const ids = knownUsers(req.query.users)
  if (!ids.length) return res.status(400).json({ error: 'users required' })
  res.json(recommend(groupOf(ids), { kind: kindParam(req.query.kind) }))
})

// «Не сегодня»: прячет фильм из рекомендаций этого пользователя на несколько дней.
app.post('/api/snooze', (req, res) => {
  const [user] = knownUsers([req.body?.user])
  const movie = movieOf(req.body?.movieId)
  if (!user || !movie) return res.status(400).json({ error: 'user and movieId required' })
  const days = Math.min(Math.max(Number(req.body.days) || 14, 1), 365)
  const mine = (db.snooze[user] ??= {})
  const now = Date.now()
  for (const [id, until] of Object.entries(mine)) if (until < now) delete mine[id]
  mine[movie.id] = now + days * 86400_000
  save()
  res.json({ ok: true })
})

app.delete('/api/snooze', userParam, (req, res) => {
  delete db.snooze[req.userId]?.[req.query.movie]
  save()
  res.json({ ok: true })
})

app.get('/api/stats', userParam, (req, res) => res.json(stats(entriesOf(req.userId))))

app.get('/api/compat', (req, res) => {
  const [a, b] = knownUsers(req.query.users)
  if (!a || !b) return res.status(400).json({ error: 'two users required' })
  res.json(compatibility(entriesOf(a), entriesOf(b)))
})

// «Выбор на вечер»: все голосуют «да»/«нет» по одному короткому списку; первый фильм, получивший все «да», и выбирается.
const TONIGHT_SIZE = 12
function tonightView() {
  const t = db.tonight
  if (!t) return null
  const match = t.movies.find((id) => t.users.every((u) => t.votes[u]?.[id] === true))
  return { users: t.users, kind: t.kind ?? 'movie', startedAt: t.startedAt, movies: t.movies.map(movieOf).filter(Boolean), votes: t.votes, match: match ?? null }
}

app.get('/api/tonight', (req, res) => res.json(tonightView()))

// more: true берёт следующие фильмы, а не начинает сначала
app.post('/api/tonight', (req, res) => {
  const ids = knownUsers(req.body?.users)
  if (!ids.length) return res.status(400).json({ error: 'users required' })
  const more = req.body.more && db.tonight
  const shown = more ? db.tonight.shown : []
  const kind = more ? db.tonight.kind : kindParam(req.body.kind)
  const movies = recommend(groupOf(ids), { kind, freshLimit: 200 }).fresh.map((r) => r.movie.id).filter((id) => !shown.includes(id)).slice(0, TONIGHT_SIZE)
  db.tonight = { users: ids, kind, movies, shown: [...shown, ...movies], votes: {}, startedAt: Date.now() }
  save()
  res.json(tonightView())
})

app.post('/api/tonight/vote', (req, res) => {
  const t = db.tonight
  const { user, movieId, yes } = req.body ?? {}
  if (!t || !t.users.includes(user) || !t.movies.includes(movieId) || typeof yes !== 'boolean') return res.status(400).json({ error: 'bad vote' })
  ;(t.votes[user] ??= {})[movieId] = yes
  save()
  res.json(tonightView())
})

app.delete('/api/tonight', (req, res) => {
  db.tonight = null
  save()
  res.json(null)
})

app.get('/api/search', userParam, (req, res) => {
  const q = String(req.query.q ?? '').trim().toLowerCase()
  if (q.length < 2) return res.json([])
  const es = entriesOf(req.userId)
  const out = []
  for (const m of surveyOrder) {
    if (m.title.toLowerCase().includes(q) || m.titleRu?.toLowerCase().includes(q)) {
      out.push({ movie: m, entry: es[m.id] ?? null })
      if (out.length >= 20) break
    }
  }
  res.json(out)
})

app.use('/avatars', express.static(AVATARS))
app.use('/posters', express.static(POSTERS, { maxAge: '30d' }))

if (fs.existsSync(DIST)) {
  app.use(express.static(DIST))
  app.get(/^\/(?!api\/).*/, (req, res) => res.sendFile(path.join(DIST, 'index.html')))
}

// Еженедельное обновление каталога: новинки, сериалы и свежие рейтинги из TMDB, затем id Кинопоиска из Wikidata.
// Работает в фоне; новые данные сервер подхватывает, завершаясь, когда сайтом 10 минут никто не пользуется, —
// поэтому нужен сторожевой перезапуск (KINO_WATCHDOG ставит start-kino.vbs), который снова его поднимет.
const UPDATE_EVERY = 7 * 86400_000
let updating = false, restartSince = 0, lastAttempt = 0
function runScript(script, env = {}) {
  return new Promise((resolve, reject) => {
    const log = fs.openSync(path.join(ROOT, 'data/update.log'), 'a')
    const child = spawn(process.execPath, [path.join(ROOT, 'scripts', script)], { cwd: ROOT, env: { ...process.env, ...env }, stdio: ['ignore', log, log], windowsHide: true })
    child.on('error', reject)
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${script} exited with ${code}`))))
  })
}
function catalogueUpdate() {
  const now = Date.now()
  if (restartSince) {
    if (now - lastRequest > 10 * 60_000 || now - restartSince > 86400_000) process.exit(0)
    return
  }
  const tmdbFile = path.join(ROOT, 'data/model/tmdb.json')
  if (updating || now - lastAttempt < 6 * 3600_000) return
  if (!fs.existsSync(path.join(ROOT, 'data/tmdb.key')) || !fs.existsSync(tmdbFile)) return
  if (now - fs.statSync(tmdbFile).mtimeMs < UPDATE_EVERY) return
  updating = true
  lastAttempt = now
  console.log('catalogue update started')
  runScript('tmdb.mjs', { TMDB_DISCOVER: '1' })
    .then(() => runScript('enrich-wikidata.mjs'))
    .then(() => {
      console.log('catalogue update finished, restarting when idle')
      restartSince = Date.now()
    })
    .catch((e) => console.error(`catalogue update failed: ${e.message}`))
    .finally(() => { updating = false })
}
if (process.env.KINO_WATCHDOG && !process.env.KINO_DB) setInterval(catalogueUpdate, 10 * 60_000).unref()

app.listen(PORT, '0.0.0.0', () => {
  console.log(`kino: http://localhost:${PORT}`)
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list ?? []) if (a.family === 'IPv4' && !a.internal) console.log(`      http://${a.address}:${PORT}`)
  }
})
