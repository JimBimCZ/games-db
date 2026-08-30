import { z } from 'zod'

export const SEARCH_MIN = 2
export const SEARCH_MAX = 100
export const SEARCH_LIMIT = 50
export const GENRE_PAGE_SIZE = 60
export const MIN_GENRE_GAMES = 3

const searchQuery = z.string().trim().min(SEARCH_MIN).max(SEARCH_MAX)
const pageNumber = z.coerce.number().int().min(1).max(1000)
const genreId = z.string().regex(/^\d+$/).max(10)
const appid = z.coerce.number().int().min(1).max(2147483647)

export function parseSearchQuery(raw: string | undefined): string | null {
  const parsed = searchQuery.safeParse(raw ?? '')
  return parsed.success ? parsed.data : null
}

export function parsePage(raw: string | undefined): number {
  const parsed = pageNumber.safeParse(raw ?? '1')
  return parsed.success ? parsed.data : 1
}

export function parseGenreId(raw: string): string | null {
  const parsed = genreId.safeParse(raw)
  return parsed.success ? parsed.data : null
}

export function parseAppid(raw: string): number | null {
  const parsed = appid.safeParse(raw)
  return parsed.success ? parsed.data : null
}
