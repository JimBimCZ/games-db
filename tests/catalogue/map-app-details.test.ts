import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { mapGameRow, mapMediaRows, mapPriceRow, parseReleaseDate } from '@/server/catalogue/map-app-details'
import { parseAppDetails } from '@/server/steam/schemas'

const details = (name: string, appid: number) => {
  const raw = JSON.parse(readFileSync(path.join(import.meta.dirname, '../fixtures/steam', name), 'utf8'))
  const result = parseAppDetails(raw, appid)
  if (result.kind !== 'ok') throw new Error(`fixture ${name} did not parse as ok`)
  return result.data
}

const FETCHED = new Date('2026-08-30T12:00:00Z')

describe('mapGameRow', () => {
  it('maps the identity and flags', () => {
    const row = mapGameRow(details('appdetails-620.json', 620), FETCHED)
    expect(row.appid).toBe(620)
    expect(row.type).toBe('game')
    expect(row.name).toBeTruthy()
    expect(row.fetchedAt).toBe(FETCHED)
  })

  it('sanitises the description HTML', () => {
    const data = details('appdetails-620.json', 620)
    const row = mapGameRow(
      { ...data, about_the_game: '<p>Safe</p><script>alert(1)</script><img src=x onerror=alert(1)>' },
      FETCHED,
    )
    expect(row.aboutHtml).toContain('Safe')
    expect(row.aboutHtml).not.toContain('<script')
    expect(row.aboutHtml).not.toContain('onerror')
  })

  it('keeps the release date text and parses what it can', () => {
    const row = mapGameRow(
      { ...details('appdetails-620.json', 620), release_date: { coming_soon: false, date: '10 Oct, 2007' } },
      FETCHED,
    )
    expect(row.releaseDateText).toBe('10 Oct, 2007')
    expect(row.releaseComingSoon).toBe(false)
    expect(row.releaseDate?.getUTCFullYear()).toBe(2007)
  })

  it('stores null rather than a guess for an unparseable release date', () => {
    const row = mapGameRow(
      { ...details('appdetails-620.json', 620), release_date: { coming_soon: true, date: 'Q4 2026' } },
      FETCHED,
    )
    expect(row.releaseDateText).toBe('Q4 2026')
    expect(row.releaseComingSoon).toBe(true)
    expect(row.releaseDate).toBeNull()
  })
})

describe('mapMediaRows', () => {
  it('reads media URLs from the payload and never constructs them', () => {
    const rows = mapMediaRows(details('appdetails-1174180.json', 1174180))
    expect(rows.length).toBeGreaterThan(0)
    for (const row of rows) {
      expect(['screenshot', 'movie']).toContain(row.kind)
      expect(row.appid).toBe(1174180)
    }
    const movies = rows.filter((r) => r.kind === 'movie')
    if (movies.length > 0) {
      expect(movies[0]!.hlsUrl ?? movies[0]!.dashH264Url).toBeTruthy()
    }
    expect(rows.filter((r) => r.kind === 'screenshot').map((r) => r.position)).toEqual(
      rows.filter((r) => r.kind === 'screenshot').map((_, i) => i),
    )
  })

  it('returns an empty list when there is no media', () => {
    const data = details('appdetails-620.json', 620)
    expect(mapMediaRows({ ...data, screenshots: undefined, movies: undefined })).toEqual([])
  })
})

describe('mapPriceRow', () => {
  it('reads minor units and the currency from the payload', () => {
    const row = mapPriceRow(details('appdetails-620.json', 620), 'cz', FETCHED)
    expect(row).not.toBeNull()
    expect(row!.currency).toBe('EUR')
    expect(row!.cc).toBe('cz')
    expect(Number.isInteger(row!.finalMinor)).toBe(true)
  })

  it('returns null for a free game', () => {
    expect(mapPriceRow(details('appdetails-570.json', 570), 'cz', FETCHED)).toBeNull()
  })
})

describe('parseReleaseDate', () => {
  it.each([
    ['10 Oct, 2007', 2007],
    ['21 Nov, 2024', 2024],
  ])('parses %s', (text, year) => {
    expect(parseReleaseDate(text)?.getUTCFullYear()).toBe(year)
  })

  it.each(['Q4 2026', 'Coming soon', '', 'To be announced'])('returns null for %s', (text) => {
    expect(parseReleaseDate(text)).toBeNull()
  })
})
