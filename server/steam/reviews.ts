import 'server-only'
import { steamFetchJson } from './client.ts'
import { parseReviewSummary, type ReviewSummary } from './schemas.ts'

export function reviewsUrl(appid: number): URL {
  const url = new URL(`https://store.steampowered.com/appreviews/${appid}`)
  url.searchParams.set('json', '1')
  // num_per_page=0 means review bodies never arrive, rather than arriving and being
  // discarded. purchase_type must be pinned: it defaults to steam, and the totals move with
  // it — a ~6% swing was observed between steam and all.
  url.searchParams.set('num_per_page', '0')
  url.searchParams.set('purchase_type', 'all')
  return url
}

export async function fetchReviewSummary(appid: number): Promise<ReviewSummary> {
  return parseReviewSummary(await steamFetchJson(reviewsUrl(appid)))
}
