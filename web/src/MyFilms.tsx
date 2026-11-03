import { useCallback, useEffect, useState } from 'react'
import { api, type EntryPatch, type MovieEntry, type User } from './api'
import { StatsCard, StopGenres } from './Extras'
import { MovieTitle, Poster, RateControls, statusLabel } from './components'

const FILTERS = {
  rated: 'Оценённые',
  want: 'Хочу',
  plans: 'Планы',
  no: 'Не хочу',
  all: 'Все',
} as const
type Filter = keyof typeof FILTERS

export default function MyFilms({ user, onChange }: { user: User; onChange: () => void }) {
  const userId = user.id
  const [items, setItems] = useState<MovieEntry[]>([])
  const [found, setFound] = useState<MovieEntry[] | null>(null)
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState<Filter>('rated')
  const [open, setOpen] = useState<number | null>(null)

  const load = useCallback(() => {
    api.entries(userId).then(setItems)
  }, [userId])
  useEffect(load, [load])

  useEffect(() => {
    if (q.trim().length < 2) return setFound(null)
    const timer = setTimeout(() => api.search(userId, q).then(setFound), 250)
    return () => clearTimeout(timer)
  }, [q, userId, items])

  async function saveEntry(movieId: number, patch: EntryPatch) {
    await api.setEntry(userId, movieId, patch)
    setOpen(null)
    onChange()
    load()
  }

  async function remove(movieId: number) {
    await api.deleteEntry(userId, movieId)
    setOpen(null)
    onChange()
    load()
  }

  const shown =
    found ??
    items.filter(({ entry: e }) =>
      filter === 'all'
        ? true
        : filter === 'rated'
          ? !!e?.rating
          : filter === 'plans'
            ? e?.progress === 'watching' || e?.progress === 'planned'
            : filter === 'want'
              ? e?.wish === 'yes'
              : e?.wish === 'no' || e?.progress === 'dropped',
    )

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Найти фильм и оценить…"
        className="w-full rounded-lg bg-zinc-900 px-3 py-2 outline-none ring-amber-400 placeholder:text-zinc-500 focus:ring-1"
      />
      {!found && <StatsCard userId={userId} />}
      {!found && <StopGenres user={user} onChange={onChange} />}
      {!found && (
        <div className="flex flex-wrap gap-2">
          {(Object.keys(FILTERS) as Filter[]).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium ${filter === f ? 'bg-zinc-100 text-zinc-950' : 'bg-zinc-800 text-zinc-300'}`}
            >
              {FILTERS[f]}
            </button>
          ))}
        </div>
      )}
      {shown.length === 0 && <div className="text-zinc-400">{found ? 'Ничего не найдено.' : 'Пока пусто.'}</div>}
      <ul className="space-y-2">
        {shown.map(({ movie, entry }) => (
          <li key={movie.id} className="rounded-xl bg-zinc-900 p-3">
            <button className="flex w-full items-center gap-3 text-left" onClick={() => setOpen(open === movie.id ? null : movie.id)}>
              <Poster movie={movie} className="h-16 w-11 shrink-0 rounded" />
              <div className="min-w-0 flex-1">
                <MovieTitle movie={movie} />
              </div>
              <div className="shrink-0 text-right text-sm text-amber-400">{entry ? statusLabel(entry) : '—'}</div>
            </button>
            {open === movie.id && (
              <div className="mt-3 space-y-3 border-t border-zinc-800 pt-3">
                <RateControls movie={movie} entry={entry} onSave={(patch) => saveEntry(movie.id, patch)} />
                {entry && (
                  <button className="text-sm text-red-400 hover:text-red-300" onClick={() => remove(movie.id)}>
                    Сбросить ответ
                  </button>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
