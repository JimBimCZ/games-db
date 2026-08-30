import { describe, expect, it } from 'vitest'
import { priceDelta } from '@/lib/format/price-delta'

describe('priceDelta', () => {
  it('reports a drop since the game was wishlisted', () => {
    const delta = priceDelta(4199, 'EUR', 3199, 'EUR')
    expect(delta?.direction).toBe('down')
    expect(delta?.label).toContain('10.00')
  })

  it('reports a rise', () => {
    const delta = priceDelta(3199, 'EUR', 4199, 'EUR')
    expect(delta?.direction).toBe('up')
    expect(delta?.label).toContain('10.00')
  })

  it('reports nothing when the price has not moved', () => {
    expect(priceDelta(4199, 'EUR', 4199, 'EUR')).toBeNull()
  })

  it('reports nothing when no price was captured', () => {
    expect(priceDelta(null, null, 3199, 'EUR')).toBeNull()
  })

  it('reports nothing when the game has no current price', () => {
    expect(priceDelta(4199, 'EUR', null, null)).toBeNull()
  })

  // We never convert currencies, so a currency change makes the two amounts incomparable.
  it('reports nothing when the currency changed', () => {
    expect(priceDelta(4199, 'EUR', 3199, 'USD')).toBeNull()
  })
})
