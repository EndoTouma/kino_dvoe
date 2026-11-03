import { useCallback, useEffect, useRef, useState } from 'react'
import { api, type EntryPatch, type Kind, type Movie } from './api'
import { MovieTitle, Overview, Poster, RateControls } from './components'

const GOALS = { movie: 200, tv: 100 } // size of the initial survey; it simply continues after that

export default function Survey({
  userId,
  kind,
  onChange,
  onSearch,
}: {
  userId: string
  kind: Kind
  onChange: () => void
  onSearch: () => void
}) {
  const GOAL = GOALS[kind]
  const [queue, setQueue] = useState<Movie[]>([])
  const [history, setHistory] = useState<Movie[]>([])
  const [stats, setStats] = useState({ answered: 0, rated: 0 })
  const [done, setDone] = useState(false)
  const loading = useRef(false)
  const again = useRef(false)
  const answered = useRef(new Set<number>())

  // Сервер перестраивает очередь после каждого ответа, так что всё за фильмом
  // на экране заменяется свежим порядком.
  const refill = useCallback(async () => {
    if (loading.current) {
      again.current = true
      return
    }
    loading.current = true
    try {
      do {
        again.current = false
        const s = await api.survey(userId, 6, kind)
        setStats({ answered: s.answered, rated: s.rated })
        setQueue((q) => {
          const head = q[0]
          const fresh = s.movies.filter((m) => m.id !== head?.id && !answered.current.has(m.id))
          const next = head ? [head, ...fresh] : fresh
          setDone(next.length === 0)
          return next
        })
      } while (again.current)
    } finally {
      loading.current = false
    }
  }, [userId, kind])

  useEffect(() => {
    setQueue([])
    setHistory([])
    answered.current.clear()
    refill()
  }, [refill])

  const movie = queue[0]

  async function answer(patch: EntryPatch) {
    if (!movie) return
    await api.setEntry(userId, movie.id, patch)
    answered.current.add(movie.id)
    setHistory((h) => [...h.slice(-20), movie])
    setQueue((q) => q.filter((m) => m.id !== movie.id))
    onChange()
    refill()
  }

  async function back() {
    const prev = history[history.length - 1]
    if (!prev) return
    await api.deleteEntry(userId, prev.id)
    answered.current.delete(prev.id)
    setHistory((h) => h.slice(0, -1))
    setQueue((q) => [prev, ...q])
    onChange()
  }

  return (
    <div className="mx-auto max-w-md space-y-4">
      <div>
        <div className="mb-1 flex justify-between text-sm text-zinc-400">
          <span>Пройдено: {stats.answered}{stats.answered < GOAL ? ` из ${GOAL}` : ''}</span>
          <span>Оценено: {stats.rated}</span>
        </div>
        <div className="h-1.5 overflow-hidden rounded bg-zinc-800">
          <div className="h-full bg-amber-400 transition-all" style={{ width: `${Math.min(100, (stats.answered / GOAL) * 100)}%` }} />
        </div>
      </div>

      {movie ? (
        <div key={movie.id} className="space-y-4 rounded-2xl bg-zinc-900 p-4">
          <div className="flex gap-4">
            <Poster movie={movie} className="h-44 w-30 shrink-0 rounded-lg" />
            <div className="min-w-0 space-y-2">
              <MovieTitle movie={movie} />
              <Overview movie={movie} lines="line-clamp-4" />
            </div>
          </div>
          <RateControls movie={movie} onSave={answer} />
        </div>
      ) : (
        <div className="rounded-2xl bg-zinc-900 p-8 text-center text-zinc-400">{done ? (kind === 'tv' ? 'Сериалы закончились 🎉' : 'Фильмы закончились 🎉') : 'Загрузка…'}</div>
      )}

      <div className="flex justify-between text-sm text-zinc-400">
        {history.length > 0 ? (
          <button className="hover:text-zinc-200" onClick={back}>
            ← Вернуть предыдущий
          </button>
        ) : (
          <span />
        )}
        <button className="hover:text-zinc-200" onClick={onSearch}>
          {kind === 'tv' ? 'Найти сериал самому →' : 'Найти фильм самому →'}
        </button>
      </div>
    </div>
  )
}
