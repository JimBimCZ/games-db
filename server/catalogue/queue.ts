import 'server-only'
import { sql } from 'drizzle-orm'
import type { JobDb } from '../../db/client.ts'

export const HYDRATE_LOCK_KEY = 4801001
export const PRICES_LOCK_KEY = 4801002
export const LISTS_LOCK_KEY = 4801003

const FIFTEEN_MIN = 15 * 60_000
const MAX_BACKOFF_MS = 24 * 60 * 60_000
const UNAVAILABLE_RECHECK_MS = 30 * 24 * 60 * 60_000

export function backoffMs(failureCount: number, random: () => number = Math.random): number {
  if (!Number.isInteger(failureCount) || failureCount < 1) {
    throw new RangeError(`failureCount must be a positive integer, got ${failureCount}`)
  }
  // 2 ** 200 is Infinity, and Math.min handles it, but the exponent is capped anyway so the
  // intermediate value stays a number a reader can reason about.
  const exponent = Math.min(failureCount, 20)
  const base = Math.min(FIFTEEN_MIN * 2 ** exponent, MAX_BACKOFF_MS)
  return Math.round(base * (0.8 + random() * 0.4))
}

export async function tryAdvisoryLock(db: JobDb, key: number): Promise<boolean> {
  const { rows } = await db.execute<{ locked: boolean }>(
    sql`select pg_try_advisory_lock(${key}) as locked`,
  )
  return rows[0]?.locked === true
}

export async function releaseAdvisoryLock(db: JobDb, key: number): Promise<void> {
  await db.execute(sql`select pg_advisory_unlock(${key})`)
}

export async function selectDueApps(
  db: JobDb,
  opts: { limit: number; type?: 'game' | 'dlc' },
): Promise<number[]> {
  const typeFilter = opts.type ? sql`and app_type = ${opts.type}` : sql``
  const { rows } = await db.execute<{ appid: number }>(sql`
    select appid from steam_app
    where hydration_state in ('pending', 'failed')
      and (next_attempt_at is null or next_attempt_at <= now())
      ${typeFilter}
    order by (app_type = 'game') desc, steam_last_modified desc nulls last, appid
    limit ${opts.limit}
  `)
  return rows.map((r) => r.appid)
}

export async function markOk(db: JobDb, appid: number): Promise<void> {
  await db.execute(sql`
    update steam_app
    set hydration_state = 'ok', failure_count = 0, next_attempt_at = null
    where appid = ${appid}
  `)
}

export async function markUnavailable(db: JobDb, appid: number): Promise<void> {
  await db.execute(sql`
    update steam_app
    set hydration_state = 'unavailable',
        failure_count = 0,
        next_attempt_at = now() + ${`${UNAVAILABLE_RECHECK_MS} milliseconds`}::interval
    where appid = ${appid}
  `)
}

export async function markFailed(db: JobDb, appid: number): Promise<void> {
  const { rows } = await db.execute<{ failure_count: number }>(sql`
    update steam_app set failure_count = failure_count + 1, hydration_state = 'failed'
    where appid = ${appid}
    returning failure_count
  `)
  const count = rows[0]?.failure_count ?? 1
  await db.execute(sql`
    update steam_app
    set next_attempt_at = now() + ${`${backoffMs(count)} milliseconds`}::interval
    where appid = ${appid}
  `)
}
