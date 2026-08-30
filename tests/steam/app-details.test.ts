import { describe, expect, it } from 'vitest'
import { appDetailsUrl } from '@/server/steam/app-details'

describe('appDetailsUrl', () => {
  it('sends cc and l with a single appid', () => {
    const url = appDetailsUrl(620, 'cz', 'english')
    expect(url.searchParams.get('appids')).toBe('620')
    expect(url.searchParams.get('cc')).toBe('cz')
    expect(url.searchParams.get('l')).toBe('english')
  })
})
