export type Wish = 'yes' | 'no'
export type Kind = 'movie' | 'tv'
export type Progress = 'watching' | 'dropped' | 'planned'

export interface User {
  id: string
  name: string
  avatar?: number
  blockGenres?: string[]
  answered: number
  rated: number
}

export interface Movie {
  id: number
  kind?: Kind
  seasons?: number
  episodes?: number
  status?: string
  title: string
  titleRu?: string
  year: number | null
  genres: string[]
  kp?: number
  poster?: string
  overview?: string
  runtime?: number
  tagline?: string
  released?: string
  countries?: string[]
  budget?: number
  revenue?: number
  cast?: string[]
  directors?: string[]
  mean: number
}

export interface Entry {
  seen: boolean
  rating?: number
  unrated?: boolean
  forgot?: boolean
  progress?: Progress
  season?: number
  wish?: Wish
  watchedAt?: string
  t: number
}

export interface EntryPatch {
  seen?: boolean
  rating?: number | null
  wish?: Wish | null
  forgot?: boolean
  progress?: Progress | null
  season?: number
}

export interface MovieEntry {
  movie: Movie
  entry: Entry | null
}

export interface Rec {
  movie: Movie
  score: number
  per: Record<string, { pred: number; seen: boolean; low: boolean; rating: number | null; wish: Wish | null; forgot: boolean; progress: Progress | null; season: number | null }>
  why: { title: string; users: string[] }[]
}

export interface StatRow {
  name: string
  avg: number
  count: number
}

export interface Stats {
  films: number
  series: number
  want: number
  no: number
  rated: number
  mean: number
  histogram: number[]
  genres: StatRow[]
  directors: StatRow[]
  actors: StatRow[]
  decades: StatRow[]
}

export type RecLists = Record<'fresh' | 'recent' | 'show' | 'rewatch' | 'plans', Rec[]>

export interface TonightState {
  users: string[]
  kind: Kind
  startedAt: number
  movies: Movie[]
  votes: Record<string, Record<string, boolean>>
  match: number | null
}

export interface Compat {
  common: number
  percent: number | null
  loved: { movie: Movie; ratings: [number, number] }[]
  split: { movie: Movie; ratings: [number, number] }[]
  wantBoth: Movie[]
}

export interface Watched {
  movie: Movie
  at: string
  users: string[]
  ratings: Record<string, number | null>
}

async function call<T>(url: string, method = 'GET', body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? res.statusText)
  return res.json()
}

export const api = {
  users: () => call<User[]>('/api/users'),
  addUser: (name: string) => call<User>('/api/users', 'POST', { name }),
  renameUser: (id: string, name: string) => call<User>(`/api/users/${id}`, 'PATCH', { name }),
  setAvatar: (id: string, image: string) => call<User>(`/api/users/${id}/avatar`, 'PUT', { image }),
  deleteUser: (id: string) => call(`/api/users/${id}`, 'DELETE'),
  survey: (user: string, limit: number, kind: Kind) =>
    call<{ movies: Movie[]; answered: number; rated: number }>(`/api/survey?user=${user}&limit=${limit}&kind=${kind}`),
  entries: (user: string) => call<(MovieEntry & { entry: Entry })[]>(`/api/entries?user=${user}`),
  pending: (user: string) => call<(MovieEntry & { entry: Entry })[]>(`/api/pending?user=${user}`),
  setEntry: (user: string, movie: number, patch: EntryPatch) =>
    call<Entry & { prev: Entry | null }>(`/api/entries/${user}/${movie}`, 'PUT', patch),
  deleteEntry: (user: string, movie: number) => call(`/api/entries/${user}/${movie}`, 'DELETE'),
  watched: (movieId: number, users: string[], ratings: Record<string, number> = {}) =>
    call('/api/watched', 'POST', { movieId, users, ratings }),
  together: () => call<Watched[]>('/api/watched'),
  genres: () => call<string[]>('/api/genres'),
  setBlockGenres: (id: string, blockGenres: string[]) => call<User>(`/api/users/${id}`, 'PATCH', { blockGenres }),
  snooze: (user: string, movieId: number) => call('/api/snooze', 'POST', { user, movieId }),
  unsnooze: (user: string, movieId: number) => call(`/api/snooze?user=${user}&movie=${movieId}`, 'DELETE'),
  stats: (user: string) => call<Stats>(`/api/stats?user=${user}`),
  compat: (a: string, b: string) => call<Compat>(`/api/compat?users=${a},${b}`),
  tonight: () => call<TonightState | null>('/api/tonight'),
  startTonight: (users: string[], kind: Kind, more = false) => call<TonightState>('/api/tonight', 'POST', { users, kind, more }),
  voteTonight: (user: string, movieId: number, yes: boolean) => call<TonightState>('/api/tonight/vote', 'POST', { user, movieId, yes }),
  endTonight: () => call<null>('/api/tonight', 'DELETE'),
  recs: (users: string[], kind: Kind) =>
    call<RecLists>(`/api/recs?users=${users.join(',')}&kind=${kind}`),
  search: (user: string, q: string) => call<MovieEntry[]>(`/api/search?user=${user}&q=${encodeURIComponent(q)}`),
}

export const GENRES: Record<string, string> = {
  Action: 'боевик', Adventure: 'приключения', Animation: 'мультфильм', Children: 'детский', Comedy: 'комедия',
  Crime: 'криминал', Documentary: 'документальный', Drama: 'драма', Fantasy: 'фэнтези', 'Film-Noir': 'нуар',
  Horror: 'ужасы', IMAX: 'IMAX', Musical: 'мюзикл', Mystery: 'детектив', Romance: 'мелодрама',
  'Sci-Fi': 'фантастика', Thriller: 'триллер', War: 'военный', Western: 'вестерн',
}
