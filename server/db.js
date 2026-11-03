// Крошечное документное хранилище на JSON-файле: всё состояние в памяти, сброс в data/db.json.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// KINO_DB направляет второй экземпляр (тесты) на собственный файл, чтобы он не затёр рабочую базу
const FILE = process.env.KINO_DB ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../data/db.json')

// users: [{ id, name }]
// entries: { [userId]: { [movieId]: { seen, rating?, unrated?, forgot?, wish?, progress?, season?, watchedAt?, t } } }
// watched: [{ movieId, users: [userId], at }] — совместные просмотры
// snooze: { [userId]: { [movieId]: скрытьДо } } — «не сегодня»
// tonight: { users, movies, shown, votes: { [userId]: { [movieId]: boolean } }, startedAt } | null — сессия «выбора на вечер»
export const db = { users: [], entries: {}, watched: [], snooze: {}, tonight: null }

if (fs.existsSync(FILE)) Object.assign(db, JSON.parse(fs.readFileSync(FILE, 'utf8')))

// Одна копия базы в день: её снимает первый запрос сервера в этот день; хранятся последние KEEP штук.
const BACKUPS = path.join(path.dirname(FILE), 'backup', 'auto')
const KEEP = 14
function backup() {
  try {
    if (!fs.existsSync(FILE)) return
    const target = path.join(BACKUPS, `db-${new Date().toLocaleDateString('sv')}.json`)
    if (fs.existsSync(target)) return
    fs.mkdirSync(BACKUPS, { recursive: true })
    fs.copyFileSync(FILE, target)
    const old = fs.readdirSync(BACKUPS).filter((f) => /^db-\d{4}-\d\d-\d\d\.json$/.test(f)).sort().slice(0, -KEEP)
    for (const f of old) fs.rmSync(path.join(BACKUPS, f))
  } catch (e) {
    console.error(`db backup failed (${e.code ?? e.message})`)
  }
}
backup()
setInterval(backup, 3600_000).unref()

let timer = null
export function save() {
  if (timer) return
  timer = setTimeout(() => {
    timer = null
    try {
      fs.mkdirSync(path.dirname(FILE), { recursive: true })
      fs.writeFileSync(FILE + '.tmp', JSON.stringify(db))
      fs.renameSync(FILE + '.tmp', FILE)
    } catch (e) {
      // В Windows файл на мгновение может держать другая программа (антивирус, индексатор, IDE).
      // Данные целы в памяти — продолжаем обслуживать и повторяем попытку позже.
      console.error(`db save failed (${e.code ?? e.message}), retrying`)
      setTimeout(save, 1000)
    }
  }, 200)
}
