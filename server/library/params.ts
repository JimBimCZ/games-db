import { z } from 'zod'
import { LIBRARY_STATUSES, type LibraryStatus } from '../../lib/library/statuses.ts'

export const LIBRARY_ROW_LIMIT = 500

export const SORT_KEYS = ['name', 'added', 'price', 'status'] as const
export type SortKey = (typeof SORT_KEYS)[number]
export type SortDir = 'asc' | 'desc'

const statusSchema = z.enum(LIBRARY_STATUSES)
const sortSchema = z.enum(SORT_KEYS)
const dirSchema = z.enum(['asc', 'desc'])
const appidSchema = z.coerce.number().int().min(1).max(2147483647)

export function parseStatusFilter(raw: string | undefined): LibraryStatus | null {
  const parsed = statusSchema.safeParse(raw)
  return parsed.success ? parsed.data : null
}

export function parseStatus(raw: unknown): LibraryStatus | null {
  const parsed = statusSchema.safeParse(raw)
  return parsed.success ? parsed.data : null
}

export function parseSort(raw: string | undefined): SortKey {
  const parsed = sortSchema.safeParse(raw)
  return parsed.success ? parsed.data : 'added'
}

export function parseDir(raw: string | undefined): SortDir {
  const parsed = dirSchema.safeParse(raw)
  return parsed.success ? parsed.data : 'desc'
}

export function parseAppidInput(raw: unknown): number | null {
  if (typeof raw !== 'number' && typeof raw !== 'string') return null
  const parsed = appidSchema.safeParse(raw)
  return parsed.success ? parsed.data : null
}
