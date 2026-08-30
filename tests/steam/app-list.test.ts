import { readFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseAppListPage, walkAppList } from '@/server/steam/app-list'

const fixture = (name: string) =>
  JSON.parse(readFileSync(path.join(import.meta.dirname, '../fixtures/steam', name), 'utf8'))

afterEach(() => vi.unstubAllGlobals())

describe('parseAppListPage', () => {
  it('parses a full page', () => {
    const page = parseAppListPage(fixture('app-list-page.json'))
    expect(page.apps).toHaveLength(3)
    expect(page.apps[0]).toEqual({ appid: 10, name: 'Counter-Strike', lastModified: 1745368572 })
    expect(page.haveMore).toBe(true)
    expect(page.lastAppid).toBe(508530)
  })

  it('treats a page with neither cursor nor have_more_results as terminal', () => {
    const page = parseAppListPage(fixture('app-list-terminal-page.json'))
    expect(page.apps).toHaveLength(1)
    expect(page.haveMore).toBe(false)
    expect(page.lastAppid).toBeUndefined()
  })

  it('rejects a malformed page', () => {
    expect(() => parseAppListPage({ response: { apps: [{ appid: 'ten' }] } })).toThrow()
  })
})

describe('walkAppList', () => {
  it('stops on the terminal page and passes the cursor through unchanged', async () => {
    const urls: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (u: URL) => {
        urls.push(u.toString())
        const body = urls.length === 1 ? fixture('app-list-page.json') : fixture('app-list-terminal-page.json')
        return new Response(JSON.stringify(body), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }),
    )

    const batches = []
    for await (const batch of walkAppList('KEY', { includeGames: true }, { delayMs: 0 })) batches.push(batch)

    expect(batches).toHaveLength(2)
    expect(urls).toHaveLength(2)
    expect(urls[0]).toContain('last_appid=0')
    expect(urls[1]).toContain('last_appid=508530')
    expect(urls[0]).toContain('include_games=true')
    expect(urls[0]).toContain(`max_results=${50000}`)
  })

  it('throws rather than looping when the cursor fails to advance', async () => {
    const stallingPage = {
      response: { apps: [{ appid: 1, name: 'Stalled' }], have_more_results: true, last_appid: 5 },
    }
    let calls = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        calls += 1
        if (calls > 5) throw new Error('walkAppList did not throw before the stub call cap')
        return new Response(JSON.stringify(stallingPage), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }),
    )

    const drain = async () => {
      for await (const _ of walkAppList('KEY', { includeGames: true }, { delayMs: 0 })) void _
    }

    await expect(drain()).rejects.toThrow(/cursor did not advance/)
    expect(calls).toBeLessThanOrEqual(5)
  })

  it('sends if_modified_since when asked', async () => {
    const urls: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (u: URL) => {
        urls.push(u.toString())
        return new Response(JSON.stringify(fixture('app-list-terminal-page.json')), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }),
    )
    for await (const _ of walkAppList('KEY', { includeGames: true, ifModifiedSince: 1700000000 }, { delayMs: 0 })) {
      void _
    }
    expect(urls[0]).toContain('if_modified_since=1700000000')
  })
})
