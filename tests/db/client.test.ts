import { describe, expect, it, vi } from 'vitest'
import { getJobDb, resolveDriver } from '@/db/client'

describe('resolveDriver', () => {
  it('uses the Neon serverless driver on Vercel', () => {
    expect(resolveDriver({ VERCEL: '1' })).toBe('neon-http')
  })

  it('uses a node-postgres pool everywhere else', () => {
    expect(resolveDriver({})).toBe('node-postgres')
  })

  it('lets DB_DRIVER override the runtime guess', () => {
    expect(resolveDriver({ VERCEL: '1', DB_DRIVER: 'node-postgres' })).toBe('node-postgres')
  })

  it('rejects an unknown DB_DRIVER rather than silently guessing', () => {
    expect(() => resolveDriver({ DB_DRIVER: 'mysql' })).toThrow(/Unsupported DB_DRIVER/)
  })
})

describe('getJobDb', () => {
  it('refuses to hand a job the non-transactional driver', () => {
    vi.stubEnv('DB_DRIVER', 'neon-http')
    expect(() => getJobDb()).toThrow(/node-postgres/)
    vi.unstubAllEnvs()
  })
})

describe('closeDb', () => {
  it('is safe to call when no client was ever created', async () => {
    const { closeDb } = await import('@/db/client')
    await expect(closeDb()).resolves.toBeUndefined()
  })

  it('can be called multiple times without rejecting', async () => {
    const { closeDb } = await import('@/db/client')
    await closeDb()
    await expect(closeDb()).resolves.toBeUndefined()
  })

  it('getDb() after closeDb() creates a fresh instance', async () => {
    const originalUrl = process.env.DATABASE_URL
    const originalDbDriver = process.env.DB_DRIVER
    try {
      process.env.DATABASE_URL = 'postgresql://localhost/test'
      process.env.DB_DRIVER = 'node-postgres'

      const { getDb, closeDb } = await import('@/db/client')

      const firstInstance = getDb()
      await closeDb()
      const secondInstance = getDb()

      expect(firstInstance).not.toBe(secondInstance)
    } finally {
      if (originalUrl !== undefined) process.env.DATABASE_URL = originalUrl
      else delete process.env.DATABASE_URL
      if (originalDbDriver !== undefined) process.env.DB_DRIVER = originalDbDriver
      else delete process.env.DB_DRIVER
    }
  })
})
