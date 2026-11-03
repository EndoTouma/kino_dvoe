import { useEffect, useState } from 'react'
import { api, type Compat, type StatRow, type Stats, type User } from './api'

// Жанры, которые пользователь не хочет видеть ни в опросе, ни в совместных рекомендациях.
export function StopGenres({ user, onChange }: { user: User; onChange: () => void }) {
  const [open, setOpen] = useState(false)
  const [genres, setGenres] = useState<string[]>([])
  const blocked = user.blockGenres ?? []
  useEffect(() => {
    if (open && !genres.length) api.genres().then(setGenres)
  }, [open, genres.length])

  const toggle = (g: string) =>
    api.setBlockGenres(user.id, blocked.includes(g) ? blocked.filter((x) => x !== g) : [...blocked, g]).then(onChange)

  return (
    <div className="rounded-xl bg-zinc-900 p-3">
      <button className="flex w-full justify-between text-sm text-zinc-300" onClick={() => setOpen(!open)}>
        <span>Стоп-жанры{blocked.length ? `: ${blocked.join(', ')}` : ''}</span>
        <span className="text-zinc-500">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="mt-3 space-y-2">
          <div className="text-xs text-zinc-500">Фильмы отмеченных жанров не будут предлагаться ни в опросе, ни в общих рекомендациях.</div>
          <div className="flex flex-wrap gap-2">
            {genres.map((g) => (
              <button
                key={g}
                onClick={() => toggle(g)}
                className={`rounded-full px-3 py-1 text-sm ${blocked.includes(g) ? 'bg-red-500/80 text-white' : 'bg-zinc-800 text-zinc-300'}`}
              >
                {g}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function StatList({ title, rows }: { title: string; rows: StatRow[] }) {
  if (!rows.length) return null
  return (
    <div>
      <div className="mb-1 font-medium text-zinc-300">{title}</div>
      <ul className="space-y-0.5 text-zinc-400">
        {rows.map((r) => (
          <li key={r.name} className="flex justify-between gap-3">
            <span className="truncate">{r.name}</span>
            <span className="shrink-0 text-zinc-500">
              <span className="text-amber-400">{r.avg.toFixed(1)}</span> · {r.count}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

// Вкус пользователя в цифрах; грузится при раскрытии.
export function StatsCard({ userId }: { userId: string }) {
  const [open, setOpen] = useState(false)
  const [data, setData] = useState<Stats | null>(null)
  useEffect(() => {
    if (open) api.stats(userId).then(setData)
  }, [open, userId])
  const max = data ? Math.max(1, ...data.histogram) : 1
  return (
    <div className="rounded-xl bg-zinc-900 p-3">
      <button className="flex w-full justify-between text-sm text-zinc-300" onClick={() => setOpen(!open)}>
        <span>Моя статистика</span>
        <span className="text-zinc-500">{open ? '▲' : '▼'}</span>
      </button>
      {open && data && (
        <div className="mt-3 space-y-4 text-sm">
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-zinc-400">
            <span>Фильмов просмотрено: <span className="text-zinc-200">{data.films}</span></span>
            <span>Сериалов: <span className="text-zinc-200">{data.series}</span></span>
            <span>Оценок: <span className="text-zinc-200">{data.rated}</span></span>
            <span>Средняя оценка: <span className="text-zinc-200">{data.mean.toFixed(1)}</span></span>
            <span>Хочу посмотреть: <span className="text-zinc-200">{data.want}</span></span>
            <span>Не хочу: <span className="text-zinc-200">{data.no}</span></span>
          </div>
          <div>
            <div className="mb-1 font-medium text-zinc-300">Как часто ставлю оценки</div>
            <div className="flex h-20 items-end gap-1">
              {data.histogram.map((n, i) => (
                <div key={i} className="flex flex-1 flex-col items-center gap-1">
                  <div className="w-full rounded-t bg-amber-400/80" style={{ height: `${(n / max) * 56}px` }} title={String(n)} />
                  <div className="text-xs text-zinc-500">{i + 1}</div>
                </div>
              ))}
            </div>
          </div>
          <div className="text-xs text-zinc-500">Ниже: средняя оценка · сколько оценено. Сверху то, что вы оцениваете выше всего.</div>
          <StatList title="Жанры" rows={data.genres} />
          <StatList title="Режиссёры" rows={data.directors} />
          <StatList title="Актёры" rows={data.actors} />
          <StatList title="Десятилетия" rows={data.decades} />
        </div>
      )}
    </div>
  )
}

// Совместимость вкусов текущего пользователя с партнёром.
export function CompatCard({ userId, users }: { userId: string; users: User[] }) {
  const others = users.filter((u) => u.id !== userId)
  const [partner, setPartner] = useState(others[0]?.id)
  const [data, setData] = useState<Compat | null>(null)
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (partner) api.compat(userId, partner).then(setData)
  }, [userId, partner])

  if (!partner || !data) return null
  const me = users.find((u) => u.id === userId)!
  const other = users.find((u) => u.id === partner)!
  const pair = (r: [number, number]) => `${me.name} ${r[0]} · ${other.name} ${r[1]}`

  return (
    <div className="space-y-3 rounded-xl bg-zinc-900 p-4">
      {others.length > 1 && (
        <div className="flex flex-wrap gap-2">
          {others.map((u) => (
            <button
              key={u.id}
              onClick={() => setPartner(u.id)}
              className={`rounded-full px-3 py-1 text-sm ${u.id === partner ? 'bg-amber-400 text-zinc-950' : 'bg-zinc-800 text-zinc-300'}`}
            >
              {u.name}
            </button>
          ))}
        </div>
      )}
      <button className="flex w-full items-center justify-between text-left" onClick={() => setOpen(!open)}>
        <div>
          <div className="text-sm text-zinc-400">Совместимость вкусов с {other.name}</div>
          <div className="text-xs text-zinc-500">оба оценили: {data.common}</div>
        </div>
        <div className="text-3xl font-bold text-amber-400">{data.percent === null ? '—' : `${data.percent}%`}</div>
      </button>
      {data.percent === null && <div className="text-sm text-zinc-500">Нужно хотя бы 5 фильмов, которые оценили оба.</div>}
      {open && data.percent !== null && (
        <div className="space-y-3 border-t border-zinc-800 pt-3 text-sm">
          <div className="text-xs text-zinc-500">
            Оценки сравниваются относительно личной планки каждого, поэтому строгий зритель не считается несогласным со всем подряд.
          </div>
          {data.loved.length > 0 && (
            <div>
              <div className="mb-1 font-medium text-zinc-300">Оба любите</div>
              <ul className="space-y-0.5 text-zinc-400">
                {data.loved.map((x) => (
                  <li key={x.movie.id}>
                    {x.movie.titleRu ?? x.movie.title} <span className="text-zinc-600">— {pair(x.ratings)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div>
            <div className="mb-1 font-medium text-zinc-300">Сильнее всего расходитесь</div>
            <ul className="space-y-0.5 text-zinc-400">
              {data.split.map((x) => (
                <li key={x.movie.id}>
                  {x.movie.titleRu ?? x.movie.title} <span className="text-zinc-600">— {pair(x.ratings)}</span>
                </li>
              ))}
            </ul>
          </div>
          {data.wantBoth.length > 0 && (
            <div>
              <div className="mb-1 font-medium text-zinc-300">Оба хотите посмотреть</div>
              <div className="text-zinc-400">{data.wantBoth.map((m) => m.titleRu ?? m.title).join(', ')}</div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
