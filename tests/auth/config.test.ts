import { describe, expect, it } from 'vitest'

describe('auth config', () => {
  it('exports the App Router handlers', async () => {
    const mod = await import('@/server/auth/config')
    expect(typeof mod.handlers.GET).toBe('function')
    expect(typeof mod.handlers.POST).toBe('function')
  })
})
