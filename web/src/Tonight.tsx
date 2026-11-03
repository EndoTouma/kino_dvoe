import { useCallback, useEffect, useState } from 'react'
import { api, type Kind, type TonightState, type User } from './api'
import { MovieTitle, Overview, Poster } from './components'
import { TogetherPanel } from './Together'

// «Выбор на вечер»: оба голосуют «да»/«нет» по одному короткому списку, каждый со своего телефона;
// первый фильм, получивший все «да», — выбор на сегодня.
export default function Tonight({
  userId,
  users,
  group,
  kind,
  onChange,
}: {
  userId: string
  users: User[]
  group: string[]
  kind: Kind
  onChange: () => void
}) {
  const [t, setT] = useState<TonightState | null | undefined>(undefined)
  const [rating, setRating] = useState(false)

  const load = useCallback(() => {
    api.tonight().then(setT, () => {})
  }, [])
  useEffect(() => {
    load()
    const timer = setInterval(load, 3000)
    return () => clearInterval(timer)
  }, [load])

  const names = (ids: string[]) => users.filter((u) => ids.includes(u.id)).map((u) => u.name).join(' и ')
  const start = (ids: string[], more = false) => api.startTonight(ids, kind, more).then(setT)
  const close = () => api.endTonight().then(() => setT(null))

  if (t === undefined) return null

  if (!t) {
    return (
      <div className="space-y-3 rounded-2xl bg-zinc-900 p-5 text-center">
        <div className="text-4xl">🍿</div>
        <div className="text-lg font-semibold">Выбор на вечер</div>
        <p className="text-sm text-zinc-400">
          Каждый на своём телефоне отвечает «да» или «нет» на одни и те же 12 {kind === 'tv' ? 'сериалов' : 'фильмов'} из вашего списка. Первое
          совпадение, где все сказали «да», — выбор на сегодня.
        </p>
        <button
          disabled={!group.length}
          onClick={() => start(group)}
          className="rounded-lg bg-amber-400 px-4 py-2 font-medium text-zinc-950 disabled:opacity-40"
        >
          Начать{group.length ? `: ${names(group)}` : ''}
        </button>
      </div>
    )
  }

  if (!t.users.includes(userId)) {
    return (
      <div className="space-y-3 rounded-2xl bg-zinc-900 p-5 text-center">
        <p className="text-zinc-300">Сейчас выбирают: {names(t.users)}.</p>
        <button disabled={!group.length} onClick={() => start(group)} className="rounded-lg bg-zinc-800 px-4 py-2 text-sm text-zinc-200 disabled:opacity-40">
          Начать новый выбор
        </button>
      </div>
    )
  }

  const match = t.movies.find((m) => m.id === t.match)
  if (match) {
    return (
      <div className="space-y-4 rounded-2xl border border-amber-400/40 bg-amber-400/5 p-5">
        <div className="text-center text-lg font-semibold text-amber-400">Сегодня смотрим</div>
        <div className="flex gap-4">
          <Poster movie={match} className="h-44 w-30 shrink-0 rounded-lg" />
          <div className="min-w-0 space-y-2">
            <MovieTitle movie={match} />
            <Overview movie={match} lines="line-clamp-5" />
          </div>
        </div>
        {rating ? (
          <TogetherPanel
            movie={match}
            users={users}
            initialUsers={t.users}
            onCancel={() => setRating(false)}
            onDone={() => {
              setRating(false)
              close()
              onChange()
            }}
          />
        ) : (
          <div className="flex flex-wrap gap-2">
            <button className="rounded-md bg-amber-400 px-3 py-1.5 text-sm font-medium text-zinc-950" onClick={() => setRating(true)}>
              Посмотрели
            </button>
            <button className="rounded-md bg-zinc-800 px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-700" onClick={() => start(t.users, true)}>
              Выбрать другой
            </button>
            <button className="rounded-md bg-zinc-800 px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-700" onClick={close}>
              Закрыть
            </button>
          </div>
        )}
      </div>
    )
  }

  const mine = t.votes[userId] ?? {}
  const next = t.movies.find((m) => !(m.id in mine))
  const vote = (yes: boolean) => next && api.voteTonight(userId, next.id, yes).then(setT)

  if (next) {
    return (
      <div key={next.id} className="space-y-4 rounded-2xl bg-zinc-900 p-4">
        <div className="flex justify-between text-sm text-zinc-400">
          <span>Выбор на вечер: {names(t.users)}</span>
          <span>
            {Object.keys(mine).length + 1} из {t.movies.length}
          </span>
        </div>
        <div className="flex gap-4">
          <Poster movie={next} className="h-44 w-30 shrink-0 rounded-lg" />
          <div className="min-w-0 space-y-2">
            <MovieTitle movie={next} />
            <Overview movie={next} lines="line-clamp-5" />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <button className="rounded-lg bg-zinc-800 py-3 font-medium text-zinc-200 hover:bg-zinc-700" onClick={() => vote(false)}>
            Нет
          </button>
          <button className="rounded-lg bg-amber-400 py-3 font-medium text-zinc-950" onClick={() => vote(true)}>
            Да
          </button>
        </div>
        <button className="text-sm text-zinc-500 hover:text-zinc-300" onClick={close}>
          Отменить выбор
        </button>
      </div>
    )
  }

  const waiting = t.users.filter((id) => Object.keys(t.votes[id] ?? {}).length < t.movies.length)
  const liked = t.movies.filter((m) => t.users.some((id) => t.votes[id]?.[m.id]))
  return (
    <div className="space-y-3 rounded-2xl bg-zinc-900 p-5">
      {waiting.length ? (
        <p className="text-center text-zinc-300">Вы ответили на все. Ждём: {names(waiting)}…</p>
      ) : (
        <>
          <p className="text-center text-zinc-300">Совпадений нет.</p>
          {liked.length > 0 && (
            <ul className="space-y-1 text-sm text-zinc-400">
              {liked.map((m) => (
                <li key={m.id}>
                  {m.titleRu ?? m.title} — «да»: {names(t.users.filter((id) => t.votes[id]?.[m.id]))}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      <div className="flex justify-center gap-2">
        {!waiting.length && (
          <button className="rounded-md bg-amber-400 px-3 py-1.5 text-sm font-medium text-zinc-950" onClick={() => start(t.users, true)}>
            Ещё 12 фильмов
          </button>
        )}
        <button className="rounded-md bg-zinc-800 px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-700" onClick={close}>
          Закрыть
        </button>
      </div>
    </div>
  )
}
