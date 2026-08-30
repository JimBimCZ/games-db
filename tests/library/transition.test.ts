import { describe, expect, it } from 'vitest'
import { planTransition } from '@/server/library/transition'

const price = { finalMinor: 4199, currency: 'EUR' }

describe('planTransition', () => {
  it('writes a new entry', () => {
    expect(planTransition(null, 'backlog', price)).toEqual({
      kind: 'write',
      status: 'backlog',
      priceSeen: null,
    })
  })

  it('captures the price when a new entry is a wishlist entry', () => {
    expect(planTransition(null, 'wishlist', price)).toEqual({
      kind: 'write',
      status: 'wishlist',
      priceSeen: { minor: 4199, currency: 'EUR' },
    })
  })

  // 290 of 552 hydrated games have no price row at all.
  it('wishlists a game with no price without a delta', () => {
    expect(planTransition(null, 'wishlist', null)).toEqual({
      kind: 'write',
      status: 'wishlist',
      priceSeen: null,
    })
  })

  it('writes a status change', () => {
    expect(planTransition('backlog', 'playing', price)).toEqual({
      kind: 'write',
      status: 'playing',
      priceSeen: null,
    })
  })

  // Without this the history fills with duplicates every time the control is touched.
  it('does nothing when the status is unchanged', () => {
    expect(planTransition('playing', 'playing', price)).toEqual({ kind: 'noop' })
    expect(planTransition('wishlist', 'wishlist', price)).toEqual({ kind: 'noop' })
  })

  // "The price when I wishlisted it" restarts if the game left the wishlist and came back.
  it('re-captures the price on returning to the wishlist', () => {
    expect(planTransition('backlog', 'wishlist', { finalMinor: 3199, currency: 'EUR' })).toEqual({
      kind: 'write',
      status: 'wishlist',
      priceSeen: { minor: 3199, currency: 'EUR' },
    })
  })
})
