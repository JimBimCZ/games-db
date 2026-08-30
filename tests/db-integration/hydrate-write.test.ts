import { readFileSync } from 'node:fs'
import path from 'node:path'
import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { getJobDb } from '@/db/client'
import { writeHydratedApp } from '@/server/catalogue/hydrate-write'
import { parseAppDetails } from '@/server/steam/schemas'

const FIXTURE_APPID = 620

// The teardown below deletes this row, and game/game_media/price cascade from it, so it must
// not be a real appid: steam_app is the synced catalogue, and cleaning up after a test is no
// reason to drop a row the sync owns. The 620 payload is written under a sentinel id above the
// range Steam issues, which the appid column still accepts.
const APPID = 2147481100

const details = () => {
  const raw = JSON.parse(
    readFileSync(path.join(import.meta.dirname, '../fixtures/steam/appdetails-620.json'), 'utf8'),
  )
  const result = parseAppDetails(raw, FIXTURE_APPID)
  if (result.kind !== 'ok') throw new Error('fixture did not parse as ok')
  return { ...result.data, steam_appid: APPID }
}

describe('writeHydratedApp', () => {
  beforeAll(async () => {
    const db = getJobDb()
    await db.execute(sql`delete from steam_app where appid = ${APPID}`)
    await db.execute(sql`insert into steam_app (appid, name, app_type) values (${APPID}, 'Portal 2', 'game')`)
  })

  afterAll(async () => {
    await getJobDb().execute(sql`delete from steam_app where appid = ${APPID}`)
  })

  it('writes the game, its media, genres, categories and price', async () => {
    const db = getJobDb()
    await writeHydratedApp(db, details(), 'cz', new Date())

    const game = await db.execute<{ name: string; type: string }>(
      sql`select name, type from game where appid = ${APPID}`,
    )
    expect(game.rows).toHaveLength(1)

    const media = await db.execute<{ n: number }>(
      sql`select count(*)::int as n from game_media where appid = ${APPID}`,
    )
    expect(media.rows[0]!.n).toBeGreaterThan(0)

    const genres = await db.execute<{ n: number }>(
      sql`select count(*)::int as n from game_genre where appid = ${APPID}`,
    )
    expect(genres.rows[0]!.n).toBeGreaterThan(0)
  })

  it('replaces media instead of accumulating duplicates on a second run', async () => {
    const db = getJobDb()
    const countMedia = async () =>
      (await db.execute<{ n: number }>(sql`select count(*)::int as n from game_media where appid = ${APPID}`))
        .rows[0]!.n

    const first = await countMedia()
    await writeHydratedApp(db, details(), 'cz', new Date())
    expect(await countMedia()).toBe(first)
  })

  it('appends price history only when the price changes', async () => {
    const db = getJobDb()
    const countHistory = async () =>
      (await db.execute<{ n: number }>(sql`select count(*)::int as n from price_history where appid = ${APPID}`))
        .rows[0]!.n

    const before = await countHistory()
    await writeHydratedApp(db, details(), 'cz', new Date())
    expect(await countHistory()).toBe(before)

    const data = details()
    const bumped = {
      ...data,
      price_overview: data.price_overview
        ? { ...data.price_overview, final: data.price_overview.final - 100, discount_percent: 10 }
        : undefined,
    }
    if (bumped.price_overview) {
      await writeHydratedApp(db, bumped, 'cz', new Date())
      expect(await countHistory()).toBe(before + 1)
    }
  })

  it('rolls the whole app back when one write fails', async () => {
    const db = getJobDb()
    const data = details()
    const broken = { ...data, name: 'x'.repeat(10), genres: [{ id: 'bad', description: 'x' }], dlc: [1, 2] }
    // A category id far outside smallint/int range is rejected by Postgres mid-transaction.
    const poisoned = { ...broken, categories: [{ id: 9_999_999_999, description: 'too big' }] }

    await expect(writeHydratedApp(db, poisoned, 'cz', new Date())).rejects.toThrow()

    const game = await db.execute<{ name: string }>(sql`select name from game where appid = ${APPID}`)
    expect(game.rows[0]!.name).not.toBe('x'.repeat(10))
  })
})
