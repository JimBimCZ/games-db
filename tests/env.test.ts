import { describe, expect, it } from 'vitest'
import { parseServerEnv } from '@/server/env'

describe('parseServerEnv', () => {
  it('defaults the country code to cz', () => {
    expect(parseServerEnv({ DATABASE_URL: 'postgres://x' }).steamCountryCode).toBe('cz')
  })

  it('accepts an explicit country code', () => {
    const env = parseServerEnv({ DATABASE_URL: 'postgres://x', STEAM_COUNTRY_CODE: 'pl' })
    expect(env.steamCountryCode).toBe('pl')
  })

  it('fails loudly when DATABASE_URL is missing', () => {
    expect(() => parseServerEnv({})).toThrow(/DATABASE_URL/)
  })
})
