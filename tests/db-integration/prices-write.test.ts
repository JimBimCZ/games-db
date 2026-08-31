import { sql } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { getJobDb } from '@/db/client'
import { applyPriceBatch } from '@/server/catalogue/prices'
import type { PriceOverview } from '@/server/steam/schemas'

// Sentinel appids above the range Steam issues: the teardown deletes these steam_app rows and
// game and price cascade from them, so they must never collide with the synced catalogue.
const A = 2147481200
const B = 2147481201
const C = 2147481202
const CC = 'zz'

const overview = (finalMinor: number, discountPercent = 0): PriceOverview => ({
  currency: 'EUR',
  initialMinor: 1999,
  finalMinor,
  discountPercent,
})

const seed = async () => {
  const db = getJobDb()
  for (const appid of [A, B, C]) {
    await db.execute(
      sql`insert into steam_app (appid, name, app_type) values (${appid}, 'Sentinel', 'game')`,
    )
    await db.execute(
      sql`insert into game (appid, name, type, is_free) values (${appid}, 'Sentinel', 'game', false)`,
    )
  }
}

const clear = async () => {
  const db = getJobDb()
  await db.execute(sql`delete from steam_app where appid in (${A}, ${B}, ${C})`)
  await db.execute(sql`delete from price_history where cc = ${CC}`)
}

const priceRows = async () =>
  (
    await getJobDb().execute<{
      appid: number
      currency: string
      final_minor: number
      discount_percent: number
      fetched_at: string
    }>(sql`select appid, currency, final_minor, discount_percent, fetched_at
           from price where cc = ${CC} order by appid`)
  ).rows

const historyRows = async () =>
  (
    await getJobDb().execute<{ appid: number; final_minor: number }>(
      sql`select appid, final_minor from price_history where cc = ${CC} order by appid, observed_at`,
    )
  ).rows

describe('applyPriceBatch', () => {
  beforeEach(async () => {
    await clear()
    await seed()
  })

  afterAll(clear)

  it('inserts a price and a history row for an appid it has never seen', async () => {
    const now = new Date()
    const counts = await applyPriceBatch(
      getJobDb(),
      new Map([[A, overview(1999)]]),
      CC,
      now,
    )

    expect(counts).toEqual({ written: 1, changed: 1 })
    expect(await priceRows()).toMatchObject([{ appid: A, final_minor: 1999 }])
    expect(await historyRows()).toMatchObject([{ appid: A, final_minor: 1999 }])
  })

  it('writes every appid in one call and counts them all', async () => {
    const counts = await applyPriceBatch(
      getJobDb(),
      new Map([
        [A, overview(1999)],
        [B, overview(999, 50)],
        [C, overview(500, 75)],
      ]),
      CC,
      new Date(),
    )

    expect(counts).toEqual({ written: 3, changed: 3 })
    expect(await priceRows()).toMatchObject([
      { appid: A, final_minor: 1999, discount_percent: 0 },
      { appid: B, final_minor: 999, discount_percent: 50 },
      { appid: C, final_minor: 500, discount_percent: 75 },
    ])
  })

  it('skips null observations without counting them', async () => {
    const counts = await applyPriceBatch(
      getJobDb(),
      new Map([
        [A, overview(1999)],
        [B, null],
      ]),
      CC,
      new Date(),
    )

    expect(counts).toEqual({ written: 1, changed: 1 })
    expect(await priceRows()).toHaveLength(1)
  })

  it('returns zero counts and writes nothing when every observation is null', async () => {
    const counts = await applyPriceBatch(getJobDb(), new Map([[A, null]]), CC, new Date())

    expect(counts).toEqual({ written: 0, changed: 0 })
    expect(await priceRows()).toHaveLength(0)
    expect(await historyRows()).toHaveLength(0)
  })

  it('updates the existing row and appends history when the price moves', async () => {
    const db = getJobDb()
    await applyPriceBatch(db, new Map([[A, overview(1999)]]), CC, new Date(2026, 0, 1))

    const counts = await applyPriceBatch(db, new Map([[A, overview(999, 50)]]), CC, new Date())

    expect(counts).toEqual({ written: 1, changed: 1 })
    expect(await priceRows()).toMatchObject([{ appid: A, final_minor: 999, discount_percent: 50 }])
    expect(await historyRows()).toMatchObject([
      { appid: A, final_minor: 1999 },
      { appid: A, final_minor: 999 },
    ])
  })

  // The whole point of price_history: an unchanged price must not append a row every sweep, or
  // a monthly job would write 9,900 meaningless rows a year.
  it('refreshes fetched_at but appends no history when the price is unchanged', async () => {
    const db = getJobDb()
    const first = new Date(2026, 0, 1)
    await applyPriceBatch(db, new Map([[A, overview(1999)]]), CC, first)

    const second = new Date()
    const counts = await applyPriceBatch(db, new Map([[A, overview(1999)]]), CC, second)

    expect(counts).toEqual({ written: 1, changed: 0 })
    expect(await historyRows()).toHaveLength(1)
    const [row] = await priceRows()
    if (!row) throw new Error('expected a price row for the sentinel appid')
    expect(new Date(row.fetched_at).getTime()).toBe(second.getTime())
  })

  it('separates moved from unmoved appids within one batch', async () => {
    const db = getJobDb()
    await applyPriceBatch(
      db,
      new Map([
        [A, overview(1999)],
        [B, overview(999)],
      ]),
      CC,
      new Date(2026, 0, 1),
    )

    const counts = await applyPriceBatch(
      db,
      new Map([
        [A, overview(1999)],
        [B, overview(499, 50)],
        [C, overview(1500)],
      ]),
      CC,
      new Date(),
    )

    expect(counts).toEqual({ written: 3, changed: 2 })
    expect(await historyRows()).toMatchObject([
      { appid: A, final_minor: 1999 },
      { appid: B, final_minor: 999 },
      { appid: B, final_minor: 499 },
      { appid: C, final_minor: 1500 },
    ])
  })

  it('treats a currency change alone as a move', async () => {
    const db = getJobDb()
    await applyPriceBatch(db, new Map([[A, overview(1999)]]), CC, new Date(2026, 0, 1))

    const counts = await applyPriceBatch(
      db,
      new Map([[A, { ...overview(1999), currency: 'USD' }]]),
      CC,
      new Date(),
    )

    expect(counts).toEqual({ written: 1, changed: 1 })
    expect(await historyRows()).toHaveLength(2)
  })
})
