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
    const data = details('appdetails-1174180.json', 1174180)
    const rows = mapMediaRows(data)
    expect(rows.length).toBeGreaterThan(0)
    for (const row of rows) {
      expect(['screenshot', 'movie']).toContain(row.kind)
      expect(row.appid).toBe(1174180)
    }

    const fixtureScreenshots = data.screenshots ?? []
    expect(fixtureScreenshots.length).toBeGreaterThan(0)
    const screenshots = rows.filter((r) => r.kind === 'screenshot')
    expect(screenshots[0]!.fullUrl).toBe(fixtureScreenshots[0]!.path_full)
    expect(screenshots[0]!.thumbnailUrl).toBe(fixtureScreenshots[0]!.path_thumbnail)
    expect(screenshots.map((r) => r.position)).toEqual(screenshots.map((_, i) => i))

    const fixtureMovies = data.movies ?? []
    expect(fixtureMovies.length).toBeGreaterThan(0)
    const movies = rows.filter((r) => r.kind === 'movie')
    expect(movies[0]!.hlsUrl).toBe(fixtureMovies[0]!.hls_h264 ?? null)
    expect(movies[0]!.dashH264Url).toBe(fixtureMovies[0]!.dash_h264 ?? null)
    expect(movies.map((r) => r.position)).toEqual(movies.map((_, i) => i))
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

  it.each([
    'Q4 2026',
    'Coming soon',
    '',
    'To be announced',
    '2026',
    'Winter 2026',
    'Early 2026',
    'Holiday 2026',
    'TBA 2026',
    'March 2026',
  ])('returns null for %s', (text) => {
    expect(parseReleaseDate(text)).toBeNull()
  })

  // V8 parses non-ISO date strings in the local timezone. Under a timezone ahead of UTC (e.g.
  // Europe/Prague), "1 Jan, 2008" parsed via Date.parse rolls back to 2007-12-31T23:00:00Z,
  // corrupting the stored year. Date.UTC sidesteps this entirely, so the assertion pins the
  // exact instant rather than just a UTC year that a local-time parse could still land on for
  // dates further from midnight.
  it('anchors to UTC regardless of local timezone', () => {
    expect(parseReleaseDate('1 Jan, 2008')?.toISOString()).toBe('2008-01-01T00:00:00.000Z')
  })
})
