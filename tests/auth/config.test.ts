import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('auth config', () => {
  const original = process.env.DATABASE_URL

  beforeEach(() => {
    delete process.env.DATABASE_URL
    vi.resetModules()
  })

  afterEach(() => {
    if (original === undefined) delete process.env.DATABASE_URL
    else process.env.DATABASE_URL = original
    vi.resetModules()
  })

  it('imports with no DATABASE_URL set, so a build without secrets can collect page data', async () => {
    expect(process.env.DATABASE_URL).toBeUndefined()
    const mod = await import('@/server/auth/config')
    expect(mod.handlers).toBeDefined()
  })
})
