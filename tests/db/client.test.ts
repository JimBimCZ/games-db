import { describe, expect, it } from 'vitest'
import { resolveDriver } from '@/db/client'

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
