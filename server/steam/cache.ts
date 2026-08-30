import 'server-only'
import { isFresh } from './ttl.ts'

export type ReadThroughOptions<T> = {
  load: () => Promise<{ value: T; fetchedAt: Date } | undefined>
  ttlMs: number
  refresh: () => Promise<T>
  label: string
}

export async function readThrough<T>({ load, ttlMs, refresh, label }: ReadThroughOptions<T>): Promise<T> {
  const cached = await load()
  if (cached && isFresh(cached.fetchedAt, ttlMs)) return cached.value

  try {
    return await refresh()
  } catch (err) {
    // A stale price is better than a broken page. Only a miss with nothing cached at all
    // reaches the caller as a failure.
    console.error(`steam refresh failed for ${label}; serving stale:`, err)
    if (cached) return cached.value
    throw err
  }
}
