import { useCallback, useEffect, useState } from 'react'
import { api, type Kind, type MovieEntry, type TonightState, type User } from './api'
import { Avatar, KindSwitch, MovieInfoHost, MovieTitle, Poster, RateControls, toAvatar } from './components'
import Survey from './Survey'
import Recs, { type RecsTab } from './Recs'
import MyFilms from './MyFilms'
import Together from './Together'
import Intro from './Intro'

const TABS = { survey: 'Опрос', recs: 'Что смотреть', together: 'Вместе', mine: 'Мои фильмы' } as const
type Tab = keyof typeof TABS

const USER_KEY = 'kino.user'
const KIND_KEY = 'kino.kind'
const INTRO_KEY = 'kino.intro' // ставится после того, как карточки-инструкции показаны на этом устройстве

export default function App() {
  const [users, setUsers] = useState<User[] | null>(null)
  const [userId, setUserId] = useState<string | null>(() => localStorage.getItem(USER_KEY))
  const [tab, setTab] = useState<Tab>('survey')
  const [pending, setPending] = useState<MovieEntry[]>([])
  const [intro, setIntro] = useState(() => !localStorage.getItem(INTRO_KEY))
  const [tonight, setTonight] = useState<TonightState | null>(null)
  const [recsTab, setRecsTab] = useState<RecsTab>('fresh')
  const [kind, setKindState] = useState<Kind>(() => (localStorage.getItem(KIND_KEY) === 'tv' ? 'tv' : 'movie'))
  const setKind = (k: Kind) => {
    localStorage.setItem(KIND_KEY, k)
    setKindState(k)
  }

  const user = users?.find((u) => u.id === userId) ?? null

  const refresh = useCallback(() => {
    api.users().then(setUsers)
    if (userId) api.pending(userId).then(setPending, () => setPending([]))
  }, [userId])
  useEffect(refresh, [refresh])

  // Партнёр мог начать «выбор на вечер» со своего телефона — подхватываем без перезагрузки.
  useEffect(() => {
    const check = () => api.tonight().then(setTonight, () => {})
    check()
    const timer = setInterval(check, 10000)
    return () => clearInterval(timer)
  }, [])

  // Партнёр мог отметить просмотр со своего телефона — подхватываем напоминание без перезагрузки.
  useEffect(() => {
    const onFocus = () => document.visibilityState === 'visible' && refresh()
    document.addEventListener('visibilitychange', onFocus)
    return () => document.removeEventListener('visibilitychange', onFocus)
  }, [refresh])

  function pick(id: string | null) {
    if (id) localStorage.setItem(USER_KEY, id)
    else localStorage.removeItem(USER_KEY)
    setPending([])
    setUserId(id)
  }

  if (intro) {
    return (
      <Intro
        onDone={() => {
          localStorage.setItem(INTRO_KEY, '1')
          setIntro(false)
        }}
      />
    )
  }
  if (!users) return null
  if (!user) return <UserPicker users={users} onPick={pick} onChange={refresh} onIntro={() => setIntro(true)} />

  // мой ход в «выборе на вечер»: остались фильмы без моего голоса или уже есть совпадение
  const myTurn =
    !!tonight &&
    tonight.users.includes(user.id) &&
    (tonight.match !== null || Object.keys(tonight.votes[user.id] ?? {}).length < tonight.movies.length)

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-10 border-b border-zinc-800 bg-zinc-950/90 pt-[var(--safe-top)] backdrop-blur">
        <div className="mx-auto flex max-w-2xl items-center gap-1 px-3 py-2">
          <nav className="flex flex-1 gap-1 overflow-x-auto">
            {(Object.keys(TABS) as Tab[]).map((t) => (
              <button
                key={t}
                onClick={() => {
                  setRecsTab('fresh')
                  setTab(t)
                }}
                className={`shrink-0 rounded-lg px-2.5 py-1.5 text-sm font-medium ${tab === t ? 'bg-zinc-800 text-amber-400' : 'text-zinc-400 hover:text-zinc-200'}`}
              >
                {TABS[t]}
              </button>
            ))}
          </nav>
          <button
            className="flex shrink-0 items-center gap-1.5 rounded-full bg-zinc-800 py-1 pl-1 pr-3 text-sm"
            onClick={() => pick(null)}
            title="Сменить пользователя"
          >
            <Avatar user={user} className="h-6 w-6 text-xs" />
            {user.name}
          </button>
        </div>
      </header>

      <MovieInfoHost />
      <main className="space-y-4 px-3 py-4">
        {myTurn && !(tab === 'recs' && recsTab === 'tonight') && (
          <button
            className="mx-auto block w-full max-w-2xl rounded-2xl border border-amber-400/40 bg-amber-400/5 p-3 text-left text-amber-400"
            onClick={() => {
              setKind(tonight!.kind)
              setRecsTab('tonight')
              setTab('recs')
            }}
          >
            🍿 Идёт выбор на вечер — {tonight!.match !== null ? 'есть совпадение' : 'ваш ход'} →
          </button>
        )}
        {pending.length > 0 && (
          <div className="mx-auto max-w-2xl space-y-3 rounded-2xl border border-amber-400/40 bg-amber-400/5 p-4">
            <div className="font-semibold text-amber-400">Вы посмотрели — оцените</div>
            {pending.map(({ movie, entry }) => (
              <div key={movie.id} className="space-y-3 rounded-xl bg-zinc-900 p-3">
                <div className="flex items-center gap-3">
                  <Poster movie={movie} className="h-16 w-11 shrink-0 rounded" />
                  <MovieTitle movie={movie} />
                </div>
                <RateControls seenOnly movie={movie} entry={entry} onSave={(patch) => api.setEntry(user.id, movie.id, patch).then(refresh)} />
              </div>
            ))}
          </div>
        )}

        {(tab === 'survey' || tab === 'recs') && <KindSwitch kind={kind} onChange={setKind} />}
        {tab === 'survey' && <Survey key={kind} userId={user.id} kind={kind} onChange={refresh} onSearch={() => setTab('mine')} />}
        {tab === 'recs' && <Recs key={`${recsTab}-${kind}`} userId={user.id} users={users} kind={kind} onChange={refresh} startTab={recsTab} />}
        {tab === 'together' && <Together userId={user.id} users={users} onChange={refresh} />}
        {tab === 'mine' && <MyFilms key={user.id} user={user} onChange={refresh} />}
      </main>
    </div>
  )
}

function UserPicker({
  users,
  onPick,
  onChange,
  onIntro,
}: {
  users: User[]
  onPick: (id: string) => void
  onChange: () => void
  onIntro: () => void
}) {
  const [name, setName] = useState('')
  const [editing, setEditing] = useState(false)

  async function add() {
    if (!name.trim()) return
    await api.addUser(name)
    setName('')
    onChange()
  }

  async function rename(u: User) {
    const next = prompt('Новое имя', u.name)?.trim()
    if (next && next !== u.name) await api.renameUser(u.id, next).then(onChange)
  }

  async function setPhoto(u: User, file?: File) {
    if (!file) return
    try {
      await api.setAvatar(u.id, await toAvatar(file))
      onChange()
    } catch {
      alert('Не удалось загрузить фото. Попробуйте другое изображение (JPEG или PNG).')
    }
  }

  async function remove(u: User) {
    if (confirm(`Удалить «${u.name}» и все оценки (${u.answered})? Это необратимо.`)) await api.deleteUser(u.id).then(onChange)
  }

  return (
    <div className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-6 p-6 pt-[calc(var(--safe-top)+1.5rem)]">
      <h1 className="text-center text-3xl font-bold">
        Кино <span className="text-amber-400">на двоих</span>
      </h1>
      {users.length > 0 && <div className="text-center text-zinc-400">Кто вы?</div>}
      <ul className="space-y-2">
        {users.map((u) => (
          <li key={u.id} className="flex gap-2">
            <button className="flex min-w-0 flex-1 items-center gap-3 rounded-xl bg-zinc-900 px-4 py-3 text-left hover:bg-zinc-800" onClick={() => onPick(u.id)}>
              <Avatar user={u} className="h-12 w-12 text-lg" />
              <div className="min-w-0">
                <div className="truncate text-lg font-semibold">{u.name}</div>
                <div className="text-sm text-zinc-500">оценено {u.rated} · отвечено {u.answered}</div>
              </div>
            </button>
            {editing && (
              <>
                <label className="flex cursor-pointer items-center rounded-xl bg-zinc-900 px-3 text-zinc-300 hover:bg-zinc-800" title="Загрузить фото">
                  📷
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                      setPhoto(u, e.target.files?.[0])
                      e.target.value = ''
                    }}
                  />
                </label>
                <button className="rounded-xl bg-zinc-900 px-3 text-zinc-300 hover:bg-zinc-800" onClick={() => rename(u)} title="Переименовать">
                  ✎
                </button>
                <button className="rounded-xl bg-zinc-900 px-3 text-red-400 hover:bg-zinc-800" onClick={() => remove(u)} title="Удалить">
                  ✕
                </button>
              </>
            )}
          </li>
        ))}
      </ul>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          add()
        }}
      >
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Новый пользователь"
          maxLength={30}
          className="min-w-0 flex-1 rounded-lg bg-zinc-900 px-3 py-2 outline-none ring-amber-400 placeholder:text-zinc-500 focus:ring-1"
        />
        <button className="rounded-lg bg-amber-400 px-4 py-2 font-medium text-zinc-950">Добавить</button>
      </form>
      {users.length > 0 && (
        <button className="text-sm text-zinc-500 hover:text-zinc-300" onClick={() => setEditing(!editing)}>
          {editing ? 'Готово' : 'Настроить пользователей'}
        </button>
      )}
      <button className="text-sm text-zinc-500 hover:text-zinc-300" onClick={onIntro}>
        Как это работает?
      </button>
    </div>
  )
}
