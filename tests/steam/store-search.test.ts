import { readFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  buildSearchUrl,
  parseSearchPage,
  fetchList,
  PAGE_SIZE,
} from '@/server/steam/store-search'

// The other Steam tests read fixtures this way rather than importing the JSON.
const page = JSON.parse(
  readFileSync(
    path.join(import.meta.dirname, '../fixtures/steam/search-topsellers-page.json'),
    'utf8',
  ),
)

afterEach(() => vi.unstubAllGlobals())

describe('buildSearchUrl', () => {
  it('pins the fixed parameters and the requested page', () => {
    const url = buildSearchUrl('top_sellers', { start: 100, cc: 'cz', l: 'english' })
    expect(url.origin + url.pathname).toBe('https://store.steampowered.com/search/results/')
    expect(url.searchParams.get('category1')).toBe('998')
    expect(url.searchParams.get('count')).toBe(String(PAGE_SIZE))
    expect(url.searchParams.get('infinite')).toBe('1')
    expect(url.searchParams.get('start')).toBe('100')
    expect(url.searchParams.get('cc')).toBe('cz')
    expect(url.searchParams.get('l')).toBe('english')
  })

  it('carries the per-list parameters', () => {
    expect(buildSearchUrl('top_sellers', { start: 0, cc: 'cz', l: 'english' })
      .searchParams.get('filter')).toBe('topsellers')
    expect(buildSearchUrl('coming_soon', { start: 0, cc: 'cz', l: 'english' })
      .searchParams.get('filter')).toBe('comingsoon')
    expect(buildSearchUrl('specials', { start: 0, cc: 'cz', l: 'english' })
      .searchParams.get('specials')).toBe('1')
    expect(buildSearchUrl('new_releases', { start: 0, cc: 'cz', l: 'english' })
      .searchParams.get('sort_by')).toBe('Released_DESC')
  })
})

describe('parseSearchPage', () => {
  it('reads appids and titles from a live page', () => {
    const parsed = parseSearchPage(page)
    expect(parsed.rows.length).toBe(50)
    expect(parsed.totalCount).toBeGreaterThan(100)
    expect(parsed.start).toBe(0)
    for (const row of parsed.rows) {
      expect(Number.isInteger(row.appid)).toBe(true)
      expect(row.name.length).toBeGreaterThan(0)
    }
  })

  it('decodes HTML entities in titles', () => {
    const parsed = parseSearchPage({
      success: 1,
      total_count: 1,
      start: 0,
      results_html:
        '<a data-ds-appid="42"><span class="title">Sid Meier&#039;s Civilization&amp; VI</span></a>',
    })
    expect(parsed.rows).toEqual([{ appid: 42, name: "Sid Meier's Civilization& VI" }])
  })

  it('returns no rows for a page past the end of a list', () => {
    const parsed = parseSearchPage({
      success: 1, total_count: 2481, start: 9950, results_html: '\n<!-- List Items -->\n',
    })
    expect(parsed.rows).toEqual([])
  })

  it('rejects an envelope that is not the shape we expect', () => {
    expect(() => parseSearchPage({ success: 1 })).toThrow()
  })

  it('throws naming the appid when a row has no title span, rather than misattributing the next row', () => {
    const html =
      '<a data-ds-appid="1"><span class="title">Game One</span></a>' +
      '<a data-ds-appid="2"><span class="notitle">Whoops</span></a>' +
      '<a data-ds-appid="3"><span class="title">Game Three</span></a>'
    expect(() =>
      parseSearchPage({ success: 1, total_count: 3, start: 0, results_html: html }),
    ).toThrow(/appid 2\b/)
  })

  it('throws rather than truncating a comma-joined data-ds-appid to its first component', () => {
    const html = '<a data-ds-appid="440,570"><span class="title">Some Bundle</span></a>'
    expect(() =>
      parseSearchPage({ success: 1, total_count: 1, start: 0, results_html: html }),
    ).toThrow(/data-ds-appid/)
  })

  it('rejects an envelope whose success flag is not 1', () => {
    expect(() =>
      parseSearchPage({ success: 0, total_count: 0, start: 0, results_html: '' }),
    ).toThrow(/success/)
  })
})

const respondWith = (bodies: unknown[]) => {
  let call = 0
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      const body = bodies[Math.min(call++, bodies.length - 1)]
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }),
  )
}

describe('fetchList', () => {
  it('throws when a page returns no appids before the end of the list', async () => {
    const row = (id: number) =>
      `<a data-ds-appid="${id}"><span class="title">Game ${id}</span></a>`
    respondWith([
      {
        success: 1,
        total_count: 2481,
        start: 0,
        results_html: Array.from({ length: 50 }, (_, i) => row(i + 1)).join(''),
      },
      { success: 1, total_count: 2481, start: 50, results_html: '\n<!-- List Items -->\n' },
    ])

    await expect(
      fetchList('top_sellers', { depth: 100, cc: 'cz', l: 'english' }),
    ).rejects.toThrow(/no appids/)
  })

  it('stops without throwing when a short page ends a list', async () => {
    respondWith([
      {
        success: 1,
        total_count: 2,
        start: 0,
        results_html:
          '<a data-ds-appid="730"><span class="title">Counter-Strike 2</span></a>' +
          '<a data-ds-appid="570"><span class="title">Dota 2</span></a>',
      },
    ])

    const rows = await fetchList('specials', { depth: 100, cc: 'cz', l: 'english' })
    expect(rows).toEqual([
      { appid: 730, name: 'Counter-Strike 2' },
      { appid: 570, name: 'Dota 2' },
    ])
  })

  it('throws when a short page ends the walk with fewer rows than total_count promised', async () => {
    const row = (id: number) =>
      `<a data-ds-appid="${id}"><span class="title">Game ${id}</span></a>`
    respondWith([
      {
        success: 1,
        total_count: 60,
        start: 0,
        results_html: Array.from({ length: 30 }, (_, i) => row(i + 1)).join(''),
      },
    ])

    await expect(
      fetchList('top_sellers', { depth: 100, cc: 'cz', l: 'english' }),
    ).rejects.toThrow(/30 of 60/)
  })
})
