import { useCallback, useEffect, useRef, useState } from 'react'
import { api, type Kind, type Rec, type RecLists, type User } from './api'
import { MovieTitle, Overview, Poster } from './components'
import { TogetherPanel } from './Together'
import Tonight from './Tonight'

const TABS = {
  fresh: 'Новое для всех',
  recent: 'Новинки',
  plans: 'Планы',
  show: 'Показать партнёру',
  rewatch: 'Пересмотреть вместе',
  tonight: '🍿 Выбор на вечер',
} as const
export type RecsTab = keyof typeof TABS

const UNDO_MS = 7000

export default function Recs({
  userId,
  users,
  kind,
  onChange,
  startTab = 'fresh',
}: {
  userId: string
  users: User[]
  kind: Kind
  onChange: () => void
  startTab?: RecsTab
}) {
  const [group, setGroup] = useState<string[]>(() => (users.length <= 2 ? users.map((u) => u.id) : [userId]))
  const [data, setData] = useState<RecLists | null>(null)
  const [tab, setTab] = useState<RecsTab>(startTab)
  const [open, setOpen] = useState<number | null>(null)
  // последнее действие в одно касание — его можно отменить несколько секунд
  const [undo, setUndo] = useState<{ text: string; run: () => Promise<unknown> } | null>(null)
  const undoTimer = useRef<ReturnType<typeof setTimeout>>(undefined)

  const load = useCallback(() => {
    if (group.length) api.recs(group, kind).then(setData)
    else setData(null)
  }, [group, kind])
  useEffect(load, [load])
  useEffect(() => () => clearTimeout(undoTimer.current), [])

  const toggle = (id: string) => setGroup((g) => (g.includes(id) ? g.filter((x) => x !== id) : [...g, id]))
  const after = () => {
    onChange()
    load()
  }
  const offerUndo = (text: string, run: () => Promise<unknown>) => {
    clearTimeout(undoTimer.current)
    setUndo({ text, run })
    undoTimer.current = setTimeout(() => setUndo(null), UNDO_MS)
  }
  const name = (rec: Rec) => rec.movie.titleRu ?? rec.movie.title

  async function reject(rec: Rec) {
    const { prev } = await api.setEntry(userId, rec.movie.id, { wish: 'no' })
    after()
    offerUndo(`«${name(rec)}» — не хочу`, () =>
      prev
        ? api.setEntry(userId, rec.movie.id, {
            seen: prev.seen,
            rating: prev.rating ?? null,
            wish: prev.wish ?? null,
            forgot: prev.forgot,
            progress: prev.progress ?? null,
            season: prev.season,
          })
        : api.deleteEntry(userId, rec.movie.id),
    )
  }

  async function snooze(rec: Rec) {
    await api.snooze(userId, rec.movie.id)
    after()
    offerUndo(`«${name(rec)}» скрыт на две недели`, () => api.unsnooze(userId, rec.movie.id))
  }

  const list = tab === 'tonight' ? [] : (data?.[tab] ?? [])
  const lowData = users.filter((u) => group.includes(u.id) && u.rated < 20)
  const label = (t: RecsTab) => (t === 'plans' && kind === 'tv' ? 'Смотрим и планы' : TABS[t])

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-zinc-400">Смотрят:</span>
        {users.map((u) => (
          <button
            key={u.id}
            onClick={() => toggle(u.id)}
            className={`rounded-full px-3 py-1 text-sm ${group.includes(u.id) ? 'bg-amber-400 text-zinc-950' : 'bg-zinc-800 text-zinc-300'}`}
          >
            {u.name}
          </button>
        ))}
      </div>

      {lowData.length > 0 && (
        <div className="rounded-lg bg-zinc-900 p-3 text-sm text-zinc-400">
          Мало оценок у: {lowData.map((u) => u.name).join(', ')}. Рекомендации станут точнее после 20+ оценённых фильмов.
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {(Object.keys(TABS) as RecsTab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium ${tab === t ? 'bg-zinc-100 text-zinc-950' : 'bg-zinc-800 text-zinc-300'}`}
          >
            {label(t)} {t !== 'tonight' && data ? `(${data[t].length})` : ''}
          </button>
        ))}
      </div>

      {tab === 'tonight' && <Tonight userId={userId} users={users} group={group} kind={kind} onChange={after} />}
      {tab !== 'tonight' && !group.length && <div className="text-zinc-400">Выберите, кто смотрит.</div>}
      {tab !== 'tonight' && data && group.length > 0 && list.length === 0 && (
        <div className="text-zinc-400">
          {tab === 'plans'
            ? `Пока пусто. Отметьте «Собирались»${kind === 'tv' ? ' или «Смотрю сейчас»' : ''} в опросе или в «Моих фильмах».`
            : 'Пока пусто.'}
        </div>
      )}

      <ul className="space-y-2">
        {list.map((rec) => (
          <li key={rec.movie.id} className="rounded-xl bg-zinc-900 p-3">
            <div className="flex gap-3">
              <Poster movie={rec.movie} className="h-28 w-19 shrink-0 rounded-md" />
              <div className="flex min-w-0 flex-1 flex-col justify-between gap-2">
                <MovieTitle movie={rec.movie} />
                <Overview movie={rec.movie} lines="line-clamp-2" />
                <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-zinc-400">
                  {users.filter((u) => rec.per[u.id]).map((u) => {
                    const p = rec.per[u.id]
                    return (
                      <span key={u.id}>
                        {u.name}:{' '}
                        {p.seen && p.rating ? (
                          <span className="text-zinc-200">оценка {p.rating}</span>
                        ) : (
                          <span className={p.low ? 'text-zinc-500' : 'text-zinc-200'}>
                            прогноз {p.pred.toFixed(1)}
                            {p.low && ' · мало данных'}
                          </span>
                        )}
                        {p.forgot && <span className="text-amber-400"> смотрел, не помнит</span>}
                        {p.progress === 'watching' && <span className="text-amber-400"> ▶ смотрит{p.season ? `, сезон ${p.season}` : ''}</span>}
                        {p.progress === 'planned' && <span className="text-amber-400"> ◷ собирался</span>}
                        {p.wish === 'yes' && <span className="text-amber-400"> {p.seen ? '↻ пересмотрит' : '★ хочет'}</span>}
                      </span>
                    )
                  })}
                </div>
                {rec.why.length > 0 && (
                  <div className="text-xs text-zinc-500">
                    Похож на то, что понравилось:{' '}
                    {rec.why.map((w, k) => (
                      <span key={k}>
                        {k > 0 && ', '}
                        <span className="text-zinc-400">«{w.title}»</span>
                        {group.length > 1 && ` (${users.filter((u) => w.users.includes(u.id)).map((u) => u.name).join(', ')})`}
                      </span>
                    ))}
                  </div>
                )}
                <div className="flex flex-wrap gap-2">
                  <button
                    className="rounded-md bg-amber-400 px-3 py-1 text-sm font-medium text-zinc-950"
                    onClick={() => setOpen(open === rec.movie.id ? null : rec.movie.id)}
                  >
                    Посмотрели
                  </button>
                  <button className="rounded-md bg-zinc-800 px-3 py-1 text-sm text-zinc-300 hover:bg-zinc-700" onClick={() => snooze(rec)}>
                    Не сегодня
                  </button>
                  <button className="rounded-md bg-zinc-800 px-3 py-1 text-sm text-zinc-300 hover:bg-zinc-700" onClick={() => reject(rec)}>
                    Не хочу
                  </button>
                </div>
              </div>
              <div className="text-lg font-bold text-amber-400">{rec.score.toFixed(1)}</div>
            </div>
            {open === rec.movie.id && (
              <div className="mt-3 border-t border-zinc-800 pt-3">
                <TogetherPanel
                  movie={rec.movie}
                  users={users}
                  initialUsers={group}
                  onCancel={() => setOpen(null)}
                  onDone={() => {
                    setOpen(null)
                    after()
                  }}
                />
              </div>
            )}
          </li>
        ))}
      </ul>

      {undo && (
        <div className="fixed inset-x-0 bottom-[calc(var(--safe-bottom)+1rem)] z-40 mx-auto flex w-[calc(100%-2rem)] max-w-md items-center justify-between gap-3 rounded-xl border border-zinc-700 bg-zinc-800 px-4 py-3 shadow-lg">
          <span className="min-w-0 truncate text-sm text-zinc-200">{undo.text}</span>
          <button
            className="shrink-0 text-sm font-semibold text-amber-400"
            onClick={() => {
              clearTimeout(undoTimer.current)
              const run = undo.run
              setUndo(null)
              run().then(after)
            }}
          >
            Отменить
          </button>
        </div>
      )}
    </div>
  )
}
