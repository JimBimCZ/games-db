import { describe, expect, it } from 'vitest'
import { reviewsUrl } from '@/server/steam/reviews'

describe('reviewsUrl', () => {
  it('pins num_per_page=0 and purchase_type=all', () => {
    const url = reviewsUrl(620)
    expect(url.pathname).toBe('/appreviews/620')
    expect(url.searchParams.get('json')).toBe('1')
    // Bodies must never arrive in the first place, and purchase_type defaults to steam,
    // which moves the totals by about 6%.
    expect(url.searchParams.get('num_per_page')).toBe('0')
    expect(url.searchParams.get('purchase_type')).toBe('all')
  })
})
