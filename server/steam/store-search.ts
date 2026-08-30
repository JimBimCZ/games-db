import 'server-only'
import { z } from 'zod'
import { steamFetchJson } from './client.ts'

export type StoreListKind = 'top_sellers' | 'specials' | 'coming_soon' | 'new_releases'

export const STORE_LIST_KINDS: readonly StoreListKind[] = [
  'top_sellers',
  'specials',
  'coming_soon',
  'new_releases',
]

export const PAGE_SIZE = 50

// Only the parameters that differ per list. `filter=popularnew` and `filter=toprated` are
// deliberately absent: both returned nearly the unfiltered default ordering, so Steam
// appears to ignore filter values it does not recognise rather than erroring.
const LIST_PARAMS: Record<StoreListKind, Record<string, string>> = {
  top_sellers: { filter: 'topsellers' },
  specials: { specials: '1' },
  coming_soon: { filter: 'comingsoon' },
  new_releases: { sort_by: 'Released_DESC' },
}

const pageSchema = z.object({
  results_html: z.string(),
  total_count: z.number().int(),
  start: z.number().int(),
})

export type SearchRow = { appid: number; name: string }
export type SearchPage = { rows: SearchRow[]; totalCount: number; start: number }

export function buildSearchUrl(
  kind: StoreListKind,
  opts: { start: number; cc: string; l: string },
): URL {
  const url = new URL('https://store.steampowered.com/search/results/')
  url.searchParams.set('query', '')
  url.searchParams.set('start', String(opts.start))
  url.searchParams.set('count', String(PAGE_SIZE))
  // 998 is Steam's "Games" category. Without it the rows include bundles and packages,
  // whose data-ds-appid values are not a single appid.
  url.searchParams.set('category1', '998')
  url.searchParams.set('cc', opts.cc)
  url.searchParams.set('l', opts.l)
  url.searchParams.set('infinite', '1')
  for (const [k, v] of Object.entries(LIST_PARAMS[kind])) url.searchParams.set(k, v)
  return url
}

const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#039;': "'",
}

const decode = (s: string) => s.replace(/&(?:amp|lt|gt|quot|#039);/g, (m) => ENTITIES[m] ?? m)

export function parseSearchPage(raw: unknown): SearchPage {
  const page = pageSchema.parse(raw)
  const rows: SearchRow[] = []

  for (const match of page.results_html.matchAll(
    /data-ds-appid="(\d+)"[\s\S]*?<span class="title">([^<]*)<\/span>/g,
  )) {
    rows.push({ appid: Number(match[1]), name: decode(match[2]!.trim()) })
  }

  return { rows, totalCount: page.total_count, start: page.start }
}

export async function fetchList(
  kind: StoreListKind,
  opts: { depth: number; cc: string; l: string; delayMs?: number },
): Promise<SearchRow[]> {
  const delayMs = opts.delayMs ?? 0
  const rows: SearchRow[] = []
  const seen = new Set<number>()
  let wanted = opts.depth

  for (let start = 0; rows.length < wanted; start += PAGE_SIZE) {
    const page = parseSearchPage(
      await steamFetchJson(buildSearchUrl(kind, { start, cc: opts.cc, l: opts.l })),
    )

    // A list shorter than the requested depth is normal; asking past its end is not an error.
    wanted = Math.min(opts.depth, page.totalCount)

    // The tripwire. A markup change would empty every row this list feeds while looking
    // exactly like a list that has legitimately ended, so a short page before the end of
    // the list has to fail loudly.
    if (page.rows.length === 0 && rows.length < wanted) {
      throw new Error(
        `store search returned no appids for ${kind} at start=${start} ` +
          `(total_count ${page.totalCount}, collected ${rows.length}); the markup may have changed`,
      )
    }

    for (const row of page.rows) {
      // A repeated appid is not hypothetical: featuredcategories.top_sellers returned 3240220
      // twice in one live response. (kind, appid) is the primary key, so a duplicate reaching
      // the insert would abort the whole list rather than being ignored.
      if (seen.has(row.appid)) continue
      seen.add(row.appid)
      rows.push(row)
    }

    if (page.rows.length < PAGE_SIZE) break
    if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs))
  }

  return rows.slice(0, opts.depth)
}
