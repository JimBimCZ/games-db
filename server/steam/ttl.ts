import 'server-only'

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

// Every freshness window lives here. Scattering them through call sites is how a price ends
// up cached for a month.
export const TTL_MS = {
  price: 6 * HOUR,
  reviewSummary: 1 * DAY,
  unreleasedGameDetail: 1 * DAY,
  gameDetail: 30 * DAY,
} as const

export function isFresh(
  fetchedAt: Date | null | undefined,
  ttlMs: number,
  now: number = Date.now(),
): boolean {
  if (!fetchedAt) return false
  return now - fetchedAt.getTime() < ttlMs
}
