import 'server-only'
import { sql } from 'drizzle-orm'
import { type Db, getDb } from '../../db/client.ts'
import { steamApp } from '../../db/schema.ts'
import { type SteamAppListEntry, walkAppList } from '../steam/app-list.ts'

export type SyncCounts = { games: number; dlc: number; total: number }

// Four columns per row against Postgres' 65535-parameter ceiling.
const DEFAULT_CHUNK_SIZE = 2000

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

export async function upsertAppBatch(
  db: Db,
  rows: SteamAppListEntry[],
  appType: 'game' | 'dlc',
  seenAt: Date,
): Promise<void> {
  if (rows.length === 0) return

  await db
    .insert(steamApp)
    .values(rows.map((r) => ({ appid: r.appid, name: r.name, appType, lastSeenInListAt: seenAt })))
    .onConflictDoUpdate({
      target: steamApp.appid,
      // hydration_state, failure_count and next_attempt_at belong to the hydration queue.
      // Writing them here would re-queue the whole catalogue on every sync.
      set: {
        name: sql`excluded.name`,
        appType: sql`excluded.app_type`,
        lastSeenInListAt: sql`excluded.last_seen_in_list_at`,
      },
    })
}

async function runPass(
  db: Db,
  key: string,
  flags: { includeGames?: boolean; includeDlc?: boolean; ifModifiedSince?: number },
  appType: 'game' | 'dlc',
  seenAt: Date,
  chunkSize: number,
  delayMs: number,
): Promise<number> {
  let count = 0
  for await (const batch of walkAppList(key, flags, { delayMs })) {
    for (const part of chunk(batch, chunkSize)) {
      await upsertAppBatch(db, part, appType, seenAt)
    }
    count += batch.length
    console.log(`  ${appType}: ${count} appids upserted`)
  }
  return count
}

export async function syncCatalogue(opts: {
  key: string
  ifModifiedSince?: number
  chunkSize?: number
  delayMs?: number
}): Promise<SyncCounts> {
  const db = getDb()
  const seenAt = new Date()
  const chunkSize = opts.chunkSize ?? DEFAULT_CHUNK_SIZE
  const delayMs = opts.delayMs ?? 1200
  const since = opts.ifModifiedSince

  const games = await runPass(
    db, opts.key,
    { includeGames: true, includeDlc: false, ifModifiedSince: since },
    'game', seenAt, chunkSize, delayMs,
  )
  const dlc = await runPass(
    db, opts.key,
    { includeGames: false, includeDlc: true, ifModifiedSince: since },
    'dlc', seenAt, chunkSize, delayMs,
  )

  return { games, dlc, total: games + dlc }
}
