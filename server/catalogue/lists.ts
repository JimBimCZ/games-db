import 'server-only'
import { eq } from 'drizzle-orm'
import { getJobDb } from '../../db/client.ts'
import { steamApp, steamList } from '../../db/schema.ts'
import {
  fetchList,
  STORE_LIST_KINDS,
  type SearchRow,
  type StoreListKind,
} from '../steam/store-search.ts'
import { serverEnv } from '../env.ts'
import { LISTS_LOCK_KEY, releaseAdvisoryLock, tryAdvisoryLock } from './queue.ts'

const DEFAULT_DEPTH = 100

export function rankedRows(kind: StoreListKind, rows: SearchRow[], now: Date) {
  return rows.map((row, i) => ({ kind, appid: row.appid, rank: i + 1, fetchedAt: now }))
}

export async function syncLists(
  opts: { depth?: number; kind?: StoreListKind } = {},
): Promise<Partial<Record<StoreListKind, number>>> {
  const db = getJobDb()
  const { steamCountryCode: cc, steamLanguage: l } = serverEnv()
  const depth = opts.depth ?? DEFAULT_DEPTH
  const kinds = opts.kind ? [opts.kind] : STORE_LIST_KINDS
  const counts: Partial<Record<StoreListKind, number>> = {}

  if (!(await tryAdvisoryLock(db, LISTS_LOCK_KEY))) {
    console.log('another sync:lists run holds the lock; exiting — nothing was walked')
    return counts
  }

  try {
    for (const kind of kinds) {
      const rows = await fetchList(kind, { depth, cc, l })
      if (rows.length === 0) {
        // Steam serving a genuinely empty list is not handled — a stale list beats an empty
        // one, and this run stops rather than replacing real membership with nothing. Without
        // this check the empty values() below would fail inside Drizzle instead, which reads
        // as a library bug rather than the deliberate guarantee it actually is.
        throw new Error(`store search returned zero appids for ${kind}; refusing to replace its membership`)
      }
      const now = new Date()

      // One transaction per list, entered only after the whole walk succeeded: a failure
      // mid-walk leaves the previous membership in place. A stale list beats an empty one.
      await db.transaction(async (tx) => {
        await tx
          .insert(steamApp)
          .values(rows.map((r) => ({ appid: r.appid, name: r.name })))
          // A list can carry an appid the catalogue sync has not seen yet, and steam_app.name
          // is NOT NULL. This name is a placeholder that hydration overwrites with the
          // authoritative one; doing nothing on conflict keeps it from clobbering that.
          .onConflictDoNothing({ target: steamApp.appid })

        await tx.delete(steamList).where(eq(steamList.kind, kind))
        await tx.insert(steamList).values(rankedRows(kind, rows, now))
      })

      counts[kind] = rows.length
      console.log(`  ${kind}: ${rows.length} appids`)
    }
  } finally {
    await releaseAdvisoryLock(db, LISTS_LOCK_KEY)
  }

  return counts
}
