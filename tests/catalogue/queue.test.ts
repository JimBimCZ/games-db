import { describe, expect, it } from 'vitest'
import { backoffMs } from '@/server/catalogue/queue'

const FIFTEEN_MIN = 15 * 60_000
const DAY = 24 * 60 * 60_000

describe('backoffMs', () => {
  it('grows exponentially from fifteen minutes', () => {
    expect(backoffMs(1, () => 0.5)).toBe(2 * FIFTEEN_MIN)
    expect(backoffMs(2, () => 0.5)).toBe(4 * FIFTEEN_MIN)
    expect(backoffMs(3, () => 0.5)).toBe(8 * FIFTEEN_MIN)
  })

  it('caps at twenty-four hours', () => {
    expect(backoffMs(20, () => 0.5)).toBe(DAY)
    expect(backoffMs(200, () => 0.5)).toBe(DAY)
  })

  it('applies jitter within twenty percent either way', () => {
    expect(backoffMs(1, () => 0)).toBe(Math.round(2 * FIFTEEN_MIN * 0.8))
    expect(backoffMs(1, () => 1)).toBe(Math.round(2 * FIFTEEN_MIN * 1.2))
  })

  it('rejects a non-positive failure count', () => {
    expect(() => backoffMs(0)).toThrow(RangeError)
  })
})
