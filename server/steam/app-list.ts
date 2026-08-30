import 'server-only'
import { z } from 'zod'
import { steamFetchJson } from './client.ts'

const entrySchema = z.object({
  appid: z.number().int(),
  name: z.string(),
  last_modified: z.number().int().optional(),
})

const pageSchema = z.object({
  response: z.object({
    apps: z.array(entrySchema).default([]),
    have_more_results: z.boolean().optional(),
    last_appid: z.number().int().optional(),
  }),
})

export type SteamAppListEntry = { appid: number; name: string; lastModified?: number }
export type AppListPage = { apps: SteamAppListEntry[]; haveMore: boolean; lastAppid?: number }
export type AppListFlags = { includeGames?: boolean; includeDlc?: boolean; ifModifiedSince?: number }

export const MAX_RESULTS = 50000

export function parseAppListPage(raw: unknown): AppListPage {
  const { response } = pageSchema.parse(raw)
  return {
    apps: response.apps.map((a) => ({ appid: a.appid, name: a.name, lastModified: a.last_modified })),
    haveMore: response.have_more_results ?? false,
    lastAppid: response.last_appid,
  }
}

export async function* walkAppList(
  key: string,
  flags: AppListFlags,
  opts: { maxResults?: number; delayMs?: number } = {},
): AsyncGenerator<SteamAppListEntry[]> {
  const maxResults = opts.maxResults ?? MAX_RESULTS
  const delayMs = opts.delayMs ?? 1200
  let cursor = 0

  for (;;) {
    const url = new URL('https://api.steampowered.com/IStoreService/GetAppList/v1/')
    url.searchParams.set('key', key)
    url.searchParams.set('max_results', String(maxResults))
    url.searchParams.set('last_appid', String(cursor))
    url.searchParams.set('include_games', String(flags.includeGames ?? false))
    url.searchParams.set('include_dlc', String(flags.includeDlc ?? false))
    if (flags.ifModifiedSince !== undefined) {
      url.searchParams.set('if_modified_since', String(flags.ifModifiedSince))
    }

    const page = parseAppListPage(await steamFetchJson(url))
    yield page.apps

    // The terminal page omits both keys, so the cursor alone cannot end the loop.
    if (!page.haveMore || page.lastAppid === undefined) return

    cursor = page.lastAppid
    if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs))
  }
}
