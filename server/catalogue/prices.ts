import 'server-only'
import { and, eq, sql } from 'drizzle-orm'
import { getJobDb, type JobDb } from '../../db/client.ts'
import { price, priceHistory } from '../../db/schema.ts'
import { steamFetchJson } from '../steam/client.ts'
import { parsePriceOverviewBatch, type PriceOverview } from '../steam/schemas.ts'
import { TTL_MS } from '../steam/ttl.ts'
import { serverEnv } from '../env.ts'
import { PRICES_LOCK_KEY, releaseAdvisoryLock, tryAdvisoryLock } from './queue.ts'

// Half the largest batch verified working: 200 distinct appids returned 200 keys, and no
// boundary was found. filters=price_overview is the only appdetails form that accepts several
// appids; everything else is one appid per request. See the M3 observations doc §3.
export const PRICE_BATCH_SIZE = 100

export function priceOverviewUrl(appids: number[], cc: string, l: string): URL {
  if (appids.length === 0) throw new RangeError('priceOverviewUrl needs at least one appid')
  if (appids.length > PRICE_BATCH_SIZE) {
    throw new RangeError(`batch of ${appids.length} exceeds the observed maximum of ${PRICE_BATCH_SIZE}`)
  }
  const url = new URL('https://store.steampowered.com/api/appdetails')
  url.searchParams.set('appids', appids.join(','))
  url.searchParams.set('filters', 'price_overview')
  url.searchParams.set('cc', cc)
  url.searchParams.set('l', l)
  return url
}

export async function selectStalePriceAppids(
  db: JobDb,
  opts: { limit: number; cc: string; exclude?: ReadonlySet<number> },
): Promise<number[]> {
  const cutoff = new Date(Date.now() - TTL_MS.price)
  // An app that is not free but that Steam prices nowhere (observed: appid 271590, type game,
  // no price_overview) never gets a price row, so stamping fetched_at cannot move it out of
  // this result. Excluding what the run has already requested is what guarantees progress.
  const excluded =
    opts.exclude && opts.exclude.size > 0
      ? sql`and g.appid not in ${sql.raw(`(${[...opts.exclude].join(',')})`)}`
      : sql``
  const { rows } = await db.execute<{ appid: number }>(sql`
    select g.appid from game g
    left join price p on p.appid = g.appid and p.cc = ${opts.cc}
    where g.is_free = false and (p.fetched_at is null or p.fetched_at < ${cutoff})
      ${excluded}
    order by p.fetched_at asc nulls first, g.appid
    limit ${opts.limit}
  `)
  return rows.map((r) => r.appid)
}

export async function applyPriceBatch(
  db: JobDb,
  prices: Map<number, PriceOverview | null>,
  cc: string,
  now: Date,
): Promise<{ written: number; changed: number }> {
  let written = 0
  let changed = 0

  for (const [appid, observed] of prices) {
    if (!observed) continue

    await db.transaction(async (tx) => {
      const existing = await tx
        .select()
        .from(price)
        .where(and(eq(price.appid, appid), eq(price.cc, cc)))
        .limit(1)

      const previous = existing[0]
      const moved =
        !previous ||
        previous.currency !== observed.currency ||
        previous.initialMinor !== observed.initialMinor ||
        previous.finalMinor !== observed.finalMinor ||
        previous.discountPercent !== observed.discountPercent

      await tx
        .insert(price)
        .values({ appid, cc, ...observed, fetchedAt: now })
        .onConflictDoUpdate({
          target: [price.appid, price.cc],
          set: { ...observed, fetchedAt: now },
        })
      written += 1

      if (moved) {
        await tx.insert(priceHistory).values({ appid, cc, ...observed, observedAt: now })
        changed += 1
      }
    })
  }

  return { written, changed }
}

export type PriceCounts = { requested: number; written: number; changed: number; batches: number }

export async function refreshPrices(
  opts: { maxRequests?: number; maxDurationMs?: number } = {},
): Promise<PriceCounts> {
  const db = getJobDb()
  const { steamCountryCode: cc, steamLanguage: l } = serverEnv()
  const counts: PriceCounts = { requested: 0, written: 0, changed: 0, batches: 0 }

  if (!(await tryAdvisoryLock(db, PRICES_LOCK_KEY))) {
    console.log('another refresh:prices run holds the lock; exiting')
    return counts
  }

  const startedAt = Date.now()
  const seen = new Set<number>()
  try {
    for (;;) {
      if (opts.maxRequests !== undefined && counts.batches >= opts.maxRequests) break
      if (opts.maxDurationMs !== undefined && Date.now() - startedAt >= opts.maxDurationMs) break

      const appids = await selectStalePriceAppids(db, { limit: PRICE_BATCH_SIZE, cc, exclude: seen })
      if (appids.length === 0) break

      for (const appid of appids) seen.add(appid)
      counts.batches += 1
      counts.requested += appids.length

      const raw = await steamFetchJson(priceOverviewUrl(appids, cc, l))
      const applied = await applyPriceBatch(db, parsePriceOverviewBatch(raw), cc, new Date())
      counts.written += applied.written
      counts.changed += applied.changed

      // Moves an app that already had a price row out of the stale window. An app with no
      // price row matches nothing here, which is why `seen` above is what actually guarantees
      // the run terminates.
      await db.execute(sql`
        update price set fetched_at = now()
        where cc = ${cc} and appid in ${sql.raw(`(${appids.join(',')})`)}
      `)
    }
  } finally {
    await releaseAdvisoryLock(db, PRICES_LOCK_KEY)
  }

  return counts
}
