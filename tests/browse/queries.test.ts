import { describe, expect, it } from 'vitest'
import { toGameCard } from '@/server/browse/queries'

const row = {
  appid: 1174180,
  name: 'Red Dead Redemption 2',
  headerImage: 'https://shared.akamai.steamstatic.com/…/header.jpg',
  capsuleImage: 'https://shared.akamai.steamstatic.com/…/capsule_231x87.jpg',
  shortDescription: 'America, 1899.',
  releaseDateText: '5 Dec, 2019',
  releaseComingSoon: false,
  isFree: false,
  currency: 'EUR',
  initialMinor: 5999,
  finalMinor: 1499,
  discountPercent: 75,
}

describe('toGameCard', () => {
  it('carries the price through when every price column is present', () => {
    expect(toGameCard(row).price).toEqual({
      currency: 'EUR',
      initialMinor: 5999,
      finalMinor: 1499,
      discountPercent: 75,
    })
  })

  // 232 of the 552 hydrated games are not free and have no price row.
  it('yields a null price when the left join found nothing', () => {
    const card = toGameCard({
      ...row,
      currency: null,
      initialMinor: null,
      finalMinor: null,
      discountPercent: null,
    })
    expect(card.price).toBeNull()
    expect(card.name).toBe('Red Dead Redemption 2')
  })

  it('does not invent a price for a free game', () => {
    const card = toGameCard({
      ...row,
      isFree: true,
      currency: null,
      initialMinor: null,
      finalMinor: null,
      discountPercent: null,
    })
    expect(card.isFree).toBe(true)
    expect(card.price).toBeNull()
  })
})
