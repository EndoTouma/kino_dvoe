import { useEffect, useState, type MouseEvent, type ReactNode } from 'react'
import { GENRES, type Entry, type EntryPatch, type Kind, type Movie, type User } from './api'

const STATUS: Record<string, string> = {
  'Returning Series': 'выходит',
  Ended: 'завершён',
  Canceled: 'закрыт',
  'In Production': 'в производстве',
  Planned: 'запланирован',
}

// Переключатель «Фильмы / Сериалы» над опросом и рекомендациями.
export function KindSwitch({ kind, onChange }: { kind: Kind; onChange: (kind: Kind) => void }) {
  return (
    <div className="mx-auto flex w-fit rounded-lg bg-zinc-900 p-1">
      {(['movie', 'tv'] as const).map((k) => (
        <button
          key={k}
          onClick={() => onChange(k)}
          className={`rounded-md px-4 py-1 text-sm font-medium ${kind === k ? 'bg-amber-400 text-zinc-950' : 'text-zinc-400 hover:text-zinc-200'}`}
        >
          {k === 'movie' ? 'Фильмы' : 'Сериалы'}
        </button>
      ))}
    </div>
  )
}

export function Avatar({ user, className = 'h-10 w-10' }: { user: User; className?: string }) {
  return user.avatar ? (
    <img src={`/avatars/${user.id}.jpg?v=${user.avatar}`} alt="" className={`shrink-0 rounded-full object-cover ${className}`} />
  ) : (
    <div className={`flex shrink-0 items-center justify-center rounded-full bg-zinc-700 font-semibold text-zinc-200 ${className}`}>
      {user.name[0]?.toUpperCase()}
    </div>
  )
}

// Обрезает фото до квадрата 256px по центру и отдаёт data URL JPEG.
export async function toAvatar(file: File): Promise<string> {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' })
  const side = Math.min(bmp.width, bmp.height)
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 256
  canvas.getContext('2d')!.drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, 256, 256)
  return canvas.toDataURL('image/jpeg', 0.85)
}

const posterSrc = (movie: Movie) =>
  movie.poster
    ? `/posters/${movie.poster}`
    : movie.kp
      ? `https://st.kp.yandex.net/images/film_iphone/iphone360_${movie.kp}.jpg`
      : null

const money = new Intl.NumberFormat('ru', { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 1 })
const regions = new Intl.DisplayNames('ru', { type: 'region' })
const country = (code: string) => {
  try {
    return regions.of(code) ?? code
  } catch {
    return code
  }
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  if (!children) return null
  return (
    <div className="flex gap-3 text-sm">
      <dt className="w-24 shrink-0 text-zinc-500">{label}</dt>
      <dd className="min-w-0 text-zinc-200">{children}</dd>
    </div>
  )
}

// Открывает карточку фильма; назначается в <MovieInfoHost />, смонтированном один раз в App.
let openInfo: (movie: Movie) => void = () => {}

// Карточка фильма, открывается по тапу на постер.
export function MovieInfoHost() {
  const [movie, setMovie] = useState<Movie | null>(null)
  useEffect(() => {
    openInfo = setMovie
    return () => {
      openInfo = () => {}
    }
  }, [])
  useEffect(() => {
    if (!movie) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMovie(null)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [movie])
  if (!movie) return null
  const src = posterSrc(movie)
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 sm:items-center sm:p-4" onClick={() => setMovie(null)}>
      <div
        className="max-h-[calc(90dvh-var(--safe-top))] w-full max-w-lg space-y-4 overflow-y-auto rounded-t-2xl bg-zinc-900 p-4 pb-[calc(var(--safe-bottom)+1rem)] sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex gap-4">
          {src && <img src={src} alt="" className="h-48 w-32 shrink-0 rounded-lg bg-zinc-800 object-cover" />}
          <div className="min-w-0 flex-1 space-y-1">
            <div className="text-xl font-bold">{movie.titleRu ?? movie.title}</div>
            {movie.titleRu && movie.titleRu !== movie.title && <div className="text-sm text-zinc-400">{movie.title}</div>}
            <div className="text-sm text-zinc-400">
              {[movie.kind === 'tv' && 'сериал', movie.year, movie.runtime && (movie.kind === 'tv' ? `серии по ${movie.runtime} мин` : `${movie.runtime} мин`)]
                .filter(Boolean)
                .join(' · ')}
            </div>
            <div className="text-sm text-zinc-500">{movie.genres.map((g) => GENRES[g] ?? g).join(', ')}</div>
            {movie.tagline && <div className="pt-1 text-sm italic text-zinc-400">«{movie.tagline}»</div>}
          </div>
          <button className="self-start text-2xl leading-none text-zinc-500 hover:text-zinc-200" onClick={() => setMovie(null)} title="Закрыть">
            ×
          </button>
        </div>
        {movie.overview && <p className="text-sm text-zinc-300">{movie.overview}</p>}
        <dl className="space-y-1.5">
          <Fact label={movie.kind === 'tv' ? 'Премьера' : 'Дата выхода'}>
            {movie.released && new Date(movie.released).toLocaleDateString('ru', { day: 'numeric', month: 'long', year: 'numeric' })}
          </Fact>
          <Fact label="Страна">{movie.countries?.map(country).join(', ')}</Fact>
          <Fact label="Сезонов">{movie.seasons && `${movie.seasons}${movie.episodes ? ` (серий: ${movie.episodes})` : ''}`}</Fact>
          <Fact label="Статус">{movie.status && (STATUS[movie.status] ?? movie.status)}</Fact>
          <Fact label={movie.kind === 'tv' ? 'Создатели' : 'Режиссёр'}>{movie.directors?.join(', ')}</Fact>
          <Fact label="В ролях">{movie.cast?.join(', ')}</Fact>
          <Fact label="Бюджет">{movie.budget && money.format(movie.budget)}</Fact>
          <Fact label="Сборы">{movie.revenue && money.format(movie.revenue)}</Fact>
          <Fact label="Рейтинг">{movie.mean.toFixed(1)} / 10</Fact>
        </dl>
        {(
          <a
            href={
              movie.kp
                ? `https://www.kinopoisk.ru/film/${movie.kp}/`
                : `https://www.kinopoisk.ru/index.php?kp_query=${encodeURIComponent(`${movie.titleRu ?? movie.title} ${movie.year ?? ''}`)}`
            }
            target="_blank"
            rel="noreferrer"
            className="inline-block rounded-md bg-zinc-800 px-3 py-1.5 text-sm text-amber-400 hover:bg-zinc-700"
          >
            {movie.kp ? 'Открыть на Кинопоиске ↗' : 'Найти на Кинопоиске ↗'}
          </a>
        )}
      </div>
    </div>
  )
}

export function Poster({ movie, className = '' }: { movie: Movie; className?: string }) {
  const [broken, setBroken] = useState(false)
  useEffect(() => setBroken(false), [movie.id])
  const src = posterSrc(movie)
  const show = (e: MouseEvent) => {
    e.stopPropagation()
    openInfo(movie)
  }
  if (!src || broken) {
    return (
      <div onClick={show} className={`cursor-pointer flex items-center justify-center bg-gradient-to-br from-zinc-700 to-zinc-900 p-2 text-center text-xs text-zinc-400 ${className}`}>
        {movie.titleRu ?? movie.title}
      </div>
    )
  }
  return (
    <img
      src={src}
      alt=""
      loading="lazy"
      onError={() => setBroken(true)}
      onClick={show}
      className={`cursor-pointer bg-zinc-800 object-cover ${className}`}
    />
  )
}

export function MovieTitle({ movie }: { movie: Movie }) {
  return (
    <div className="min-w-0">
      <div className="truncate font-semibold">{movie.titleRu ?? movie.title}</div>
      <div className="truncate text-sm text-zinc-400">
        {movie.titleRu && movie.titleRu !== movie.title ? `${movie.title} · ` : ''}
        {movie.kind === 'tv' ? 'сериал · ' : ''}
        {movie.year ?? ''}
        {movie.kind === 'tv' ? (movie.seasons ? ` · сезонов: ${movie.seasons}` : '') : movie.runtime ? ` · ${movie.runtime} мин` : ''}
      </div>
      <div className="truncate text-xs text-zinc-500">{movie.genres.map((g) => GENRES[g] ?? g).join(', ')}</div>
    </div>
  )
}

const chip = (active: boolean) =>
  `rounded-lg px-3 py-2 text-sm font-medium transition ${active ? 'bg-amber-400 text-zinc-950' : 'bg-zinc-800 text-zinc-200 hover:bg-zinc-700'}`

// Выбор статуса: «не смотрел» сохраняется в одно касание; «смотрел» = оценка, затем вопрос о пересмотре.
export function RateControls({
  entry,
  onSave,
  seenOnly = false,
  movie,
}: {
  entry?: Entry | null
  onSave: (patch: EntryPatch) => void
  seenOnly?: boolean
  movie?: Movie
}) {
  const tv = movie?.kind === 'tv'
  const [pickSeason, setPickSeason] = useState(false)
  const [rating, setRating] = useState<number | null>(entry?.rating ?? null)
  const [noRating, setNoRating] = useState(!!entry?.unrated && !entry?.forgot)
  const seen = !!entry?.seen
  return (
    <div className="space-y-3">
      {!seenOnly && (
        <div>
          <div className="mb-1 text-xs uppercase tracking-wide text-zinc-500">Не смотрел</div>
          <div className="grid grid-cols-2 gap-2">
            <button className={chip(!!entry && !seen && !entry.progress && entry.wish === 'yes')} onClick={() => onSave({ seen: false, wish: 'yes' })}>
              Хочу
            </button>
            <button className={chip(entry?.progress === 'planned')} onClick={() => onSave({ seen: false, wish: null, progress: 'planned' })}>
              Собирались
            </button>
            <button className={chip(!!entry && !seen && !entry.progress && !entry.wish)} onClick={() => onSave({ seen: false, wish: null })}>
              Не знаю
            </button>
            <button className={chip(!!entry && !seen && !entry.progress && entry.wish === 'no')} onClick={() => onSave({ seen: false, wish: 'no' })}>
              Не хочу
            </button>
          </div>
          {tv && (
            <div className="mt-3">
              <div className="mb-1 text-xs uppercase tracking-wide text-zinc-500">Начал смотреть</div>
              <div className="grid grid-cols-2 gap-2">
                <button
                  className={chip(entry?.progress === 'watching' || pickSeason)}
                  onClick={() => ((movie?.seasons ?? 1) > 1 ? setPickSeason(true) : onSave({ seen: false, wish: null, progress: 'watching', season: 1 }))}
                >
                  Смотрю сейчас{entry?.progress === 'watching' && entry.season ? ` · сезон ${entry.season}` : ''}
                </button>
                <button className={chip(entry?.progress === 'dropped')} onClick={() => onSave({ seen: false, wish: null, progress: 'dropped' })}>
                  Бросил
                </button>
              </div>
              {pickSeason && (
                <div className="mt-2">
                  <div className="mb-1 text-xs text-zinc-500">На каком сезоне?</div>
                  <div className="flex flex-wrap gap-1">
                    {Array.from({ length: Math.min(movie?.seasons ?? 1, 30) }, (_, i) => i + 1).map((s) => (
                      <button
                        key={s}
                        className={`h-9 w-9 rounded-md text-sm font-semibold ${entry?.season === s ? 'bg-amber-400 text-zinc-950' : 'bg-zinc-800 hover:bg-zinc-700'}`}
                        onClick={() => onSave({ seen: false, wish: null, progress: 'watching', season: s })}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
      <div>
        <div className="mb-1 text-xs uppercase tracking-wide text-zinc-500">Смотрел — оценка</div>
        <div className="grid grid-cols-10 gap-1">
          {Array.from({ length: 10 }, (_, i) => i + 1).map((r) => (
            <button
              key={r}
              className={`rounded-md py-2 text-sm font-semibold transition ${rating === r ? 'bg-amber-400 text-zinc-950' : 'bg-zinc-800 hover:bg-zinc-700'}`}
              onClick={() => {
                setRating(r)
                setNoRating(false)
              }}
            >
              {r}
            </button>
          ))}
        </div>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <button
            className={chip(noRating)}
            onClick={() => {
              setRating(null)
              setNoRating(true)
            }}
          >
            Без оценки
          </button>
          <button className={chip(!!entry?.forgot)} onClick={() => onSave({ seen: true, rating: null, wish: null, forgot: true })}>
            Не помню
          </button>
        </div>
      </div>
      {(rating !== null || noRating) && (
        <div>
          <div className="mb-1 text-xs uppercase tracking-wide text-zinc-500">Пересмотреть?</div>
          <div className="grid grid-cols-3 gap-2">
            <button className={chip(seen && entry?.wish === 'yes')} onClick={() => onSave({ seen: true, rating, wish: 'yes' })}>
              Хочу
            </button>
            <button className={chip(seen && (!!entry?.rating || !!entry?.unrated) && !entry?.wish && !entry?.forgot)} onClick={() => onSave({ seen: true, rating, wish: null })}>
              Не знаю
            </button>
            <button className={chip(seen && entry?.wish === 'no')} onClick={() => onSave({ seen: true, rating, wish: 'no' })}>
              Не хочу
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// Сюжет, свёрнут до пары строк до тапа.
export function Overview({ movie, lines = 'line-clamp-3' }: { movie: Movie; lines?: string }) {
  const [open, setOpen] = useState(false)
  useEffect(() => setOpen(false), [movie.id])
  if (!movie.overview) return null
  return (
    <p className={`cursor-pointer text-sm text-zinc-300 ${open ? '' : lines}`} onClick={() => setOpen(!open)}>
      {movie.overview}
    </p>
  )
}

export function statusLabel(e: Entry): string {
  if (e.forgot) return 'смотрел, не помню'
  if (e.progress === 'watching') return e.season ? `смотрю · сезон ${e.season}` : 'смотрю'
  if (e.progress === 'dropped') return 'бросил'
  if (e.progress === 'planned') return 'собирались'
  if (e.seen) {
    const r = e.rating ? `${e.rating}/10` : 'без оценки'
    return e.wish === 'yes' ? `${r} · пересмотрю` : e.wish === 'no' ? `${r} · не пересматривать` : r
  }
  return e.wish === 'yes' ? 'хочу посмотреть' : e.wish === 'no' ? 'не хочу' : 'не смотрел'
}
