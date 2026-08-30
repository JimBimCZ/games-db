import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { getDb } from '@/db/client'
import { steamApp } from '@/db/schema'
import { upsertAppBatch } from '@/server/catalogue/sync'

const APPID = 2147480000

describe('upsertAppBatch', () => {
  beforeAll(async () => {
    await getDb().execute(sql`delete from steam_app where appid = ${APPID}`)
  })
  afterAll(async () => {
    await getDb().execute(sql`delete from steam_app where appid = ${APPID}`)
  })

  it('inserts a new row as pending', async () => {
    const db = getDb()
    await upsertAppBatch(db, [{ appid: APPID, name: 'Fixture One' }], 'game', new Date('2026-01-01'))

    const { rows } = await db.execute<{
      name: string
      app_type: string
      hydration_state: string
      failure_count: number
    }>(sql`select name, app_type, hydration_state, failure_count from steam_app where appid = ${APPID}`)

    expect(rows[0]).toMatchObject({
      name: 'Fixture One',
      app_type: 'game',
      hydration_state: 'pending',
      failure_count: 0,
    })
  })

  it('updates the name but never the hydration queue columns', async () => {
    const db = getDb()
    await db.execute(
      sql`update steam_app set hydration_state = 'ok', failure_count = 4,
          next_attempt_at = '2030-01-01' where appid = ${APPID}`,
    )

    await upsertAppBatch(db, [{ appid: APPID, name: 'Fixture Renamed' }], 'game', new Date('2026-02-02'))

    const { rows } = await db.execute<{
      name: string
      hydration_state: string
      failure_count: number
      next_attempt_at: string
      last_seen_in_list_at: string
    }>(sql`select name, hydration_state, failure_count, next_attempt_at, last_seen_in_list_at
           from steam_app where appid = ${APPID}`)

    expect(rows[0]!.name).toBe('Fixture Renamed')
    expect(rows[0]!.hydration_state).toBe('ok')
    expect(rows[0]!.failure_count).toBe(4)
    expect(new Date(rows[0]!.next_attempt_at).getUTCFullYear()).toBe(2030)
    expect(new Date(rows[0]!.last_seen_in_list_at).getUTCMonth()).toBe(1)
  })
})
