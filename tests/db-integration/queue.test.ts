import { sql } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { getJobDb } from '@/db/client'
import {
  HYDRATE_LOCK_KEY,
  markFailed,
  markOk,
  markUnavailable,
  releaseAdvisoryLock,
  selectDueApps,
  tryAdvisoryLock,
} from '@/server/catalogue/queue'

const BASE = 2147481000
const IDS = [BASE, BASE + 1, BASE + 2, BASE + 3, BASE + 4]

// steam_app holds ~245,000 due rows, all carrying a last_modified from the most recent sync,
// so a small limit returns a slice that never reaches the seeded rows and every ordering
// assertion below would pass vacuously against an empty filter. The limit is set above the
// whole table so the assertions are about the real global ordering.
const WHOLE_QUEUE = 300_000

const seed = async () => {
  const db = getJobDb()
  await db.execute(sql`delete from steam_app where appid in ${sql.raw(`(${IDS.join(',')})`)}`)
  await db.execute(sql`
    insert into steam_app (appid, name, app_type, hydration_state, steam_last_modified) values
      (${IDS[0]}, 'Old game',   'game', 'pending', '2020-01-01'),
      (${IDS[1]}, 'New game',   'game', 'pending', '2026-08-01'),
      (${IDS[2]}, 'No date',    'game', 'pending', null),
      (${IDS[3]}, 'Recent dlc', 'dlc',  'pending', '2026-08-20'),
      (${IDS[4]}, 'Listed old', 'game', 'pending', '2019-01-01')
  `)
  await db.execute(sql`
    insert into steam_list (kind, appid, rank) values ('top_sellers', ${IDS[4]}, 1)
  `)
}

describe('the hydration queue', () => {
  beforeEach(seed)
  afterAll(async () => {
    await getJobDb().execute(sql`delete from steam_app where appid in ${sql.raw(`(${IDS.join(',')})`)}`)
  })

  it('orders games before DLC and recent before old, with nulls last', async () => {
    const due = await selectDueApps(getJobDb(), { limit: WHOLE_QUEUE })
    const ours = due.filter((id) => IDS.includes(id))
    expect(ours).toEqual([IDS[4], IDS[1], IDS[0], IDS[2], IDS[3]])
  })

  it('puts a listed app ahead of an unlisted one that would otherwise sort first', async () => {
    const due = await selectDueApps(getJobDb(), { limit: WHOLE_QUEUE })
    const ours = due.filter((id) => IDS.includes(id))
    // IDS[4] is the oldest game seeded: without its list rank it would sort behind IDS[0].
    expect(ours[0]).toBe(IDS[4])
    expect(ours.indexOf(IDS[4]!)).toBeLessThan(ours.indexOf(IDS[0]!))
  })

  it('filters by type when asked', async () => {
    const due = await selectDueApps(getJobDb(), { limit: WHOLE_QUEUE, type: 'dlc' })
    expect(due.filter((id) => IDS.includes(id))).toEqual([IDS[3]])
  })

  it('takes a row out of the queue when marked ok', async () => {
    await markOk(getJobDb(), IDS[1]!)
    const { rows } = await getJobDb().execute<{ hydration_state: string; next_attempt_at: string | null }>(
      sql`select hydration_state, next_attempt_at from steam_app where appid = ${IDS[1]}`,
    )
    expect(rows[0]!.hydration_state).toBe('ok')
    expect(rows[0]!.next_attempt_at).toBeNull()
  })

  it('schedules a failed row into the future and counts the failure', async () => {
    await markFailed(getJobDb(), IDS[0]!)
    const { rows } = await getJobDb().execute<{ failure_count: number; next_attempt_at: string; hydration_state: string }>(
      sql`select failure_count, next_attempt_at, hydration_state from steam_app where appid = ${IDS[0]}`,
    )
    expect(rows[0]!.failure_count).toBe(1)
    expect(rows[0]!.hydration_state).toBe('failed')
    expect(new Date(rows[0]!.next_attempt_at).getTime()).toBeGreaterThan(Date.now())
  })

  it('parks an unavailable row far out but does not lose it', async () => {
    await markUnavailable(getJobDb(), IDS[2]!)
    const { rows } = await getJobDb().execute<{ hydration_state: string; next_attempt_at: string }>(
      sql`select hydration_state, next_attempt_at from steam_app where appid = ${IDS[2]}`,
    )
    expect(rows[0]!.hydration_state).toBe('unavailable')
    const days = (new Date(rows[0]!.next_attempt_at).getTime() - Date.now()) / 86_400_000
    expect(days).toBeGreaterThan(29)
  })

  it('grants the advisory lock once', async () => {
    const db = getJobDb()
    expect(await tryAdvisoryLock(db, HYDRATE_LOCK_KEY)).toBe(true)
    await releaseAdvisoryLock(db, HYDRATE_LOCK_KEY)
  })
})
