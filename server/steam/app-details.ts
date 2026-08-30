import 'server-only'
import { steamFetchJson } from './client.ts'
import { type AppDetailsResult, parseAppDetails } from './schemas.ts'

export function appDetailsUrl(appid: number, cc: string, l: string): URL {
  const url = new URL('https://store.steampowered.com/api/appdetails')
  url.searchParams.set('appids', String(appid))
  url.searchParams.set('cc', cc)
  url.searchParams.set('l', l)
  return url
}

export async function fetchAppDetails(appid: number, cc: string, l: string): Promise<AppDetailsResult> {
  return parseAppDetails(await steamFetchJson(appDetailsUrl(appid, cc, l)), appid)
}
