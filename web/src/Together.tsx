import { useCallback, useEffect, useState } from 'react'
import { api, type Movie, type MovieEntry, type User, type Watched } from './api'
import { MovieTitle, Poster } from './components'
import { CompatCard } from './Extras'

// «Посмотрели вместе»: выбор, кто смотрел, и сразу оценка каждому — по желанию.
export function TogetherPanel({
  movie,
  users,
  initialUsers,
  initialRatings = {},
  onDone,
  onCancel,
}: {
  movie: Movie
  users: User[]
  initialUsers: string[]
  initialRatings?: Record<string, number>
  onDone: () => void
  onCancel: () => void
}) {
  const [sel, setSel] = useState(initialUsers)
  const [ratings, setRatings] = useState(initialRatings)
  const [busy, setBusy] = useState(false)

  const toggle = (id: string) => setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))
  const rate = (id: string, r: number) =>
    setRatings(({ [id]: cur, ...rest }) => (cur === r ? rest : { ...rest, [id]: r }))

  async function save() {
    setBusy(true)
    try {
      await api.watched(movie.id, sel, Object.fromEntries(sel.filter((id) => ratings[id]).map((id) => [id, ratings[id]])))
      onDone()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-3">
      {users.map((u) => {
        const on = sel.includes(u.id)
        return (
          <div key={u.id} className="space-y-1">
            <button
              onClick={() => toggle(u.id)}
              className={`rounded-full px-3 py-1 text-sm ${on ? 'bg-amber-400 text-zinc-950' : 'bg-zinc-800 text-zinc-400'}`}
            >
              {u.name}
              {on ? ' смотрел(а)' : ' не смотрел(а)'}
            </button>
            {on && (
              <div className="grid grid-cols-10 gap-1">
                {Array.from({ length: 10 }, (_, i) => i + 1).map((r) => (
                  <button
                    key={r}
                    onClick={() => rate(u.id, r)}
                    className={`rounded-md py-2 text-sm font-semibold transition ${ratings[u.id] === r ? 'bg-amber-400 text-zinc-950' : 'bg-zinc-800 hover:bg-zinc-700'}`}
                  >
                    {r}
                  </button>
                ))}
              </div>
            )}
          </div>
        )
      })}
      <div className="flex items-center gap-2">
        <button
          disabled={!sel.length || busy}
          onClick={save}
          className="rounded-md bg-amber-400 px-3 py-1.5 text-sm font-medium text-zinc-950 disabled:opacity-40"
        >
          Сохранить
        </button>
        <button onClick={onCancel} className="rounded-md bg-zinc-800 px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-700">
          Отмена
        </button>
        <span className="text-xs text-zinc-500">Без оценки — напомним позже</span>
      </div>
    </div>
  )
}

export default function Together({ userId, users, onChange }: { userId: string; users: User[]; onChange: () => void }) {
  const [items, setItems] = useState<Watched[]>([])
  const [found, setFound] = useState<MovieEntry[] | null>(null)
  const [q, setQ] = useState('')
  const [open, setOpen] = useState<number | null>(null)

  const load = useCallback(() => {
    api.together().then(setItems)
  }, [])
  useEffect(load, [load])

  useEffect(() => {
    if (q.trim().length < 2) return setFound(null)
    const timer = setTimeout(() => api.search(userId, q).then(setFound), 250)
    return () => clearTimeout(timer)
  }, [q, userId])

  const everyone = users.length <= 2 ? users.map((u) => u.id) : [userId]
  const done = () => {
    setOpen(null)
    setQ('')
    onChange()
    load()
  }

  const rows = found
    ? found.map(({ movie, entry }) => ({
        movie,
        info: null as string | null,
        initialUsers: everyone,
        initialRatings: entry?.rating ? { [userId]: entry.rating } : {},
      }))
    : items.map((w) => ({
        movie: w.movie,
        info:
          new Date(w.at).toLocaleDateString('ru') +
          ' · ' +
          users.filter((u) => w.users.includes(u.id)).map((u) => `${u.name}: ${w.ratings[u.id] ?? '—'}`).join(' · '),
        initialUsers: w.users,
        initialRatings: Object.fromEntries(Object.entries(w.ratings).filter(([, r]) => r)) as Record<string, number>,
      }))

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Посмотрели вместе — найти фильм…"
        className="w-full rounded-lg bg-zinc-900 px-3 py-2 outline-none ring-amber-400 placeholder:text-zinc-500 focus:ring-1"
      />
      {!found && <CompatCard userId={userId} users={users} />}
      {!found && <div className="text-sm text-zinc-400">Просмотрено вместе: {items.length}</div>}
      {rows.length === 0 && <div className="text-zinc-400">{found ? 'Ничего не найдено.' : 'Пока пусто.'}</div>}
      <ul className="space-y-2">
        {rows.map(({ movie, info, initialUsers, initialRatings }) => (
          <li key={movie.id} className="rounded-xl bg-zinc-900 p-3">
            <button className="flex w-full items-center gap-3 text-left" onClick={() => setOpen(open === movie.id ? null : movie.id)}>
              <Poster movie={movie} className="h-16 w-11 shrink-0 rounded" />
              <div className="min-w-0 flex-1">
                <MovieTitle movie={movie} />
                {info && <div className="truncate text-sm text-amber-400">{info}</div>}
              </div>
            </button>
            {open === movie.id && (
              <div className="mt-3 border-t border-zinc-800 pt-3">
                <TogetherPanel
                  movie={movie}
                  users={users}
                  initialUsers={initialUsers}
                  initialRatings={initialRatings}
                  onCancel={() => setOpen(null)}
                  onDone={done}
                />
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
