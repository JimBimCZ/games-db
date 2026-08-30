import { describe, expect, it } from 'vitest'
import { PRICE_BATCH_SIZE, priceOverviewUrl } from '@/server/catalogue/prices'

describe('priceOverviewUrl', () => {
  it('batches appids with the price_overview filter, cc and l', () => {
    const url = priceOverviewUrl([620, 570, 730], 'cz', 'english')
    expect(url.searchParams.get('appids')).toBe('620,570,730')
    expect(url.searchParams.get('filters')).toBe('price_overview')
    expect(url.searchParams.get('cc')).toBe('cz')
    expect(url.searchParams.get('l')).toBe('english')
  })

  it('refuses a batch larger than the observed maximum', () => {
    const tooMany = Array.from({ length: PRICE_BATCH_SIZE + 1 }, (_, i) => i + 1)
    expect(() => priceOverviewUrl(tooMany, 'cz', 'english')).toThrow(RangeError)
  })

  it('refuses an empty batch', () => {
    expect(() => priceOverviewUrl([], 'cz', 'english')).toThrow(RangeError)
  })
})
