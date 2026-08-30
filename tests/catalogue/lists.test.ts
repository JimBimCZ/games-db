import { describe, expect, it } from 'vitest'
import { rankedRows } from '@/server/catalogue/lists'

const now = new Date('2026-08-30T12:00:00Z')

describe('rankedRows', () => {
  it('numbers rows from 1 in walk order', () => {
    const rows = rankedRows('top_sellers', [
      { appid: 730, name: 'Counter-Strike 2' },
      { appid: 570, name: 'Dota 2' },
    ], now)
    expect(rows).toEqual([
      { kind: 'top_sellers', appid: 730, rank: 1, fetchedAt: now },
      { kind: 'top_sellers', appid: 570, rank: 2, fetchedAt: now },
    ])
  })

  it('returns nothing for an empty list', () => {
    expect(rankedRows('specials', [], now)).toEqual([])
  })
})
