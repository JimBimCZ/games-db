import { describe, expect, it, vi } from 'vitest'
import { readThrough } from '@/server/steam/cache'

describe('readThrough', () => {
  it('returns the cached value without refreshing when fresh', async () => {
    const refresh = vi.fn(async () => 'fresh')
    const value = await readThrough({
      load: async () => ({ value: 'cached', fetchedAt: new Date() }),
      ttlMs: 60_000,
      refresh,
      label: 'test',
    })
    expect(value).toBe('cached')
    expect(refresh).not.toHaveBeenCalled()
  })

  it('refreshes when the cached value is stale', async () => {
    const value = await readThrough({
      load: async () => ({ value: 'cached', fetchedAt: new Date(Date.now() - 120_000) }),
      ttlMs: 60_000,
      refresh: async () => 'fresh',
      label: 'test',
    })
    expect(value).toBe('fresh')
  })

  it('serves the stale value when the refresh fails', async () => {
    const errors: unknown[] = []
    vi.spyOn(console, 'error').mockImplementation((...args) => errors.push(args))

    const value = await readThrough({
      load: async () => ({ value: 'cached', fetchedAt: new Date(Date.now() - 120_000) }),
      ttlMs: 60_000,
      refresh: async () => {
        throw new Error('steam is down')
      },
      label: 'appdetails 620',
    })

    expect(value).toBe('cached')
    expect(errors).toHaveLength(1)
    vi.restoreAllMocks()
  })

  it('propagates the failure when there is nothing cached', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(
      readThrough({
        load: async () => undefined,
        ttlMs: 60_000,
        refresh: async () => {
          throw new Error('steam is down')
        },
        label: 'appdetails 620',
      }),
    ).rejects.toThrow('steam is down')
    vi.restoreAllMocks()
  })
})
