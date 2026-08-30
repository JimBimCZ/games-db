import { describe, expect, it } from 'vitest'
import { parseSince } from '@/server/catalogue/since'

describe('parseSince', () => {
  it('converts a positive day count to a unix timestamp that many days ago', () => {
    const before = Math.floor(Date.now() / 1000) - 7 * 86400
    const result = parseSince(['--since=7'])
    expect(result).toBeCloseTo(before, -1)
  })

  it('rejects zero rather than falling through to Date parsing', () => {
    expect(() => parseSince(['--since=0'])).toThrow(/day count|ISO date/)
  })

  it('rejects a negative day count rather than falling through to Date parsing', () => {
    expect(() => parseSince(['--since=-5'])).toThrow(/day count|ISO date/)
  })

  it('accepts a valid ISO date', () => {
    const result = parseSince(['--since=2026-08-01'])
    expect(result).toBe(Math.floor(new Date('2026-08-01').getTime() / 1000))
  })

  it('rejects a malformed string', () => {
    expect(() => parseSince(['--since=not-a-date'])).toThrow(/day count|ISO date/)
  })
})
