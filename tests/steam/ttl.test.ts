import { describe, expect, it } from 'vitest'
import { isFresh, TTL_MS } from '@/server/steam/ttl'

describe('isFresh', () => {
  const now = new Date('2026-08-30T12:00:00Z').getTime()

  it('is fresh inside the window', () => {
    expect(isFresh(new Date(now - 60_000), TTL_MS.price, now)).toBe(true)
  })

  it('is stale outside the window', () => {
    expect(isFresh(new Date(now - TTL_MS.price - 1), TTL_MS.price, now)).toBe(false)
  })

  it('treats a missing timestamp as stale', () => {
    expect(isFresh(null, TTL_MS.price, now)).toBe(false)
    expect(isFresh(undefined, TTL_MS.price, now)).toBe(false)
  })

  it('treats a future timestamp as fresh rather than as an error', () => {
    expect(isFresh(new Date(now + 5_000), TTL_MS.price, now)).toBe(true)
  })

  it('orders the windows by volatility', () => {
    expect(TTL_MS.price).toBeLessThan(TTL_MS.reviewSummary)
    expect(TTL_MS.reviewSummary).toBeLessThanOrEqual(TTL_MS.unreleasedGameDetail)
    expect(TTL_MS.unreleasedGameDetail).toBeLessThan(TTL_MS.gameDetail)
  })
})
