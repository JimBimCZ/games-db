import { describe, expect, it } from 'vitest'
import { createLimiter } from '@/server/steam/limiter'

describe('createLimiter', () => {
  it('spaces acquisitions by the configured interval', async () => {
    const limiter = createLimiter(50) // 50/s => 20ms apart
    const started = Date.now()
    await limiter.acquire()
    await limiter.acquire()
    await limiter.acquire()
    const elapsed = Date.now() - started

    // Three acquisitions means two gaps. Timers fire late, never early, so assert the floor.
    expect(elapsed).toBeGreaterThanOrEqual(35)
  })

  it('does not delay the first acquisition', async () => {
    const limiter = createLimiter(2)
    const started = Date.now()
    await limiter.acquire()
    expect(Date.now() - started).toBeLessThan(50)
  })

  it('serialises concurrent callers instead of letting them share a slot', async () => {
    const limiter = createLimiter(100) // 10ms apart
    const order: number[] = []
    const started = Date.now()
    await Promise.all(
      [0, 1, 2, 3].map(async (i) => {
        await limiter.acquire()
        order.push(i)
      }),
    )
    expect(order).toEqual([0, 1, 2, 3])
    expect(Date.now() - started).toBeGreaterThanOrEqual(25)
  })

  it('rejects a non-positive rate', () => {
    expect(() => createLimiter(0)).toThrow(RangeError)
    expect(() => createLimiter(-1)).toThrow(RangeError)
  })
})
