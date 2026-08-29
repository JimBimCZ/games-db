import { is } from 'drizzle-orm'
import { getTableConfig, PgTable } from 'drizzle-orm/pg-core'
import { describe, expect, it } from 'vitest'
import * as schema from '@/db/schema'
import { libraryEntry, libraryStatus, price } from '@/db/schema'

const EXPECTED_TABLE_NAMES = [
  'users',
  'accounts',
  'sessions',
  'verification_tokens',
  'steam_app',
  'game',
  'game_media',
  'genre',
  'game_genre',
  'category',
  'game_category',
  'price',
  'price_history',
  'review_summary',
  'library_entry',
  'library_status_event',
]

const BANNED_COLUMN_SUBSTRINGS = [
  'steamid',
  'persona',
  'avatar',
  'profile_url',
  'recommendationid',
  'weighted_vote_score',
]

function schemaTables(): PgTable[] {
  return (Object.values(schema) as unknown[]).filter((value): value is PgTable =>
    is(value, PgTable),
  )
}

describe('schema', () => {
  it('offers exactly the five library statuses from the spec', () => {
    expect(libraryStatus.enumValues).toEqual([
      'backlog',
      'playing',
      'finished',
      'abandoned',
      'wishlist',
    ])
  })

  it('stores the currency alongside every price, since cc=cz returns EUR', () => {
    const columns = getTableConfig(price).columns.map((c) => c.name)
    expect(columns).toContain('currency')
    expect(columns).toContain('final_minor')
    expect(columns).toContain('initial_minor')
  })

  it('records the price seen when a library entry was added', () => {
    const columns = getTableConfig(libraryEntry).columns.map((c) => c.name)
    expect(columns).toContain('price_seen_minor')
    expect(columns).toContain('price_seen_currency')
  })

  it('declares exactly the sixteen tables the spec names', () => {
    const tableNames = schemaTables()
      .map((t) => getTableConfig(t).name)
      .sort()
    expect(tableNames).toEqual([...EXPECTED_TABLE_NAMES].sort())
  })

  it('keeps no column anywhere that could hold a reviewer identity', () => {
    for (const table of schemaTables()) {
      const { name: tableName, columns } = getTableConfig(table)
      for (const column of columns) {
        const lower = column.name.toLowerCase()
        const hit = BANNED_COLUMN_SUBSTRINGS.find((banned) => lower.includes(banned))
        expect(
          hit,
          `${tableName}.${column.name} looks like it stores a reviewer identity (matched "${hit}")`,
        ).toBeUndefined()
      }
    }
  })
})
