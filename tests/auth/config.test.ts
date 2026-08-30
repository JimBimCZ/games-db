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

  // The default 5000ms test timeout is too tight for this one: the dynamic import pulls in
  // next-auth, the Drizzle adapter, and the schema, and under full-suite parallel-worker CPU
  // contention that import alone has been observed to exceed 5s even though it always
  // resolves correctly. Reproduced as an intermittent failure (not a hang) running the full
  // `pnpm test` suite repeatedly on 2026-08-30.
  it(
    'imports with no DATABASE_URL set, so a build without secrets can collect page data',
    async () => {
      expect(process.env.DATABASE_URL).toBeUndefined()
      const mod = await import('@/server/auth/config')
      expect(mod.handlers).toBeDefined()
    },
    20000,
  )
})
