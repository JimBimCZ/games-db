import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  parseAppDetails,
  parsePriceOverviewBatch,
  parseReviewSummary,
  SteamParseError,
} from '@/server/steam/schemas'

const fixture = (name: string) =>
  JSON.parse(readFileSync(path.join(import.meta.dirname, '../fixtures/steam', name), 'utf8'))

describe('parseAppDetails', () => {
  it('parses a priced game', () => {
    const result = parseAppDetails(fixture('appdetails-620.json'), 620)
    expect(result.kind).toBe('ok')
    if (result.kind !== 'ok') return
    expect(result.data.steam_appid).toBe(620)
    expect(result.data.type).toBe('game')
    expect(result.data.name).toBeTruthy()
    expect(result.data.price_overview?.currency).toBe('EUR')
    expect(result.data.price_overview?.final).toBeGreaterThan(0)
  })

  it('parses a free game as ok with no price', () => {
    const result = parseAppDetails(fixture('appdetails-570.json'), 570)
    expect(result.kind).toBe('ok')
    if (result.kind !== 'ok') return
    expect(result.data.is_free).toBe(true)
    expect(result.data.price_overview).toBeUndefined()
  })

  it('reports an unknown appid as unavailable rather than throwing', () => {
    expect(parseAppDetails(fixture('appdetails-missing.json'), 999999999)).toEqual({
      kind: 'unavailable',
    })
  })

  it('reports a non-game type without special-casing it', () => {
    const result = parseAppDetails(fixture('appdetails-323180.json'), 323180)
    expect(result.kind).toBe('ok')
    if (result.kind !== 'ok') return
    expect(result.data.type).not.toBe('game')
  })

  it('treats a payload keyed by a different appid as unavailable', () => {
    expect(parseAppDetails(fixture('appdetails-620.json'), 570)).toEqual({ kind: 'unavailable' })
  })

  it('treats an explicit null data payload as unavailable rather than throwing', () => {
    expect(parseAppDetails({ '620': { success: true, data: null } }, 620)).toEqual({
      kind: 'unavailable',
    })
  })

  it('throws a SteamParseError naming the field when the shape changes', () => {
    const broken = { '620': { success: true, data: { steam_appid: '620', type: 'game', name: 'x' } } }
    try {
      parseAppDetails(broken, 620)
      throw new Error('expected parseAppDetails to throw')
    } catch (err) {
      expect(err).toBeInstanceOf(SteamParseError)
      expect((err as SteamParseError).appid).toBe(620)
      expect((err as SteamParseError).message).toContain('steam_appid')
    }
  })
})

describe('parsePriceOverviewBatch', () => {
  it('parses every returned appid', () => {
    const prices = parsePriceOverviewBatch(fixture('price-overview-batch.json'))
    expect(prices.size).toBeGreaterThan(0)
    for (const [appid, price] of prices) {
      expect(Number.isInteger(appid)).toBe(true)
      if (price) {
        expect(Number.isInteger(price.finalMinor)).toBe(true)
        expect(price.currency).toMatch(/^[A-Z]{3}$/)
      }
    }
  })

  it('parses the discounted row with initial and final not swapped', () => {
    const prices = parsePriceOverviewBatch(fixture('price-overview-batch.json'))
    expect(prices.get(1174180)).toEqual({
      currency: 'EUR',
      initialMinor: 5999,
      finalMinor: 1499,
      discountPercent: 75,
    })
    expect(prices.get(570)).toBeNull()
  })

  it('maps a free game with an empty data array to null', () => {
    const prices = parsePriceOverviewBatch({ '570': { success: true, data: [] } })
    expect(prices.get(570)).toBeNull()
  })

  it('maps an unsuccessful entry to null', () => {
    const prices = parsePriceOverviewBatch({ '999999999': { success: false } })
    expect(prices.get(999999999)).toBeNull()
  })

  it('maps an explicit null data payload to null rather than throwing', () => {
    const prices = parsePriceOverviewBatch({ '999999999': { success: true, data: null } })
    expect(prices.get(999999999)).toBeNull()
  })
})

describe('parseReviewSummary', () => {
  it('parses the aggregate and nothing else', () => {
    const summary = parseReviewSummary(fixture('appreviews-620.json'))
    expect(summary.totalReviews).toBeGreaterThan(0)
    expect(summary.totalPositive + summary.totalNegative).toBe(summary.totalReviews)
    expect(summary.reviewScoreDesc).toBeTruthy()
    expect(Object.keys(summary).sort()).toEqual(
      ['reviewScore', 'reviewScoreDesc', 'totalNegative', 'totalPositive', 'totalReviews'].sort(),
    )
  })
})
