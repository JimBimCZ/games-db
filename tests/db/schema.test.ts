import { is } from 'drizzle-orm'
import { getTableConfig, PgTable } from 'drizzle-orm/pg-core'
import { describe, expect, it } from 'vitest'
import * as schema from '@/db/schema'
import { libraryEntry, libraryStatus, price, reviewSummary } from '@/db/schema'

const EXPECTED_TABLE_NAMES = [
  'users',
  'accounts',
  'sessions',
  'verification_tokens',
  'steam_app',
  'steam_list',
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

// Not the bare substring 'review': review_summary legitimately has review_score and
// review_score_desc. These target the body of a review and the person who wrote it.
const BANNED_COLUMN_SUBSTRINGS = [
  'steamid',
  'persona',
  'avatar',
  'profile_url',
  'recommendationid',
  'weighted_vote_score',
  'author',
  'review_text',
  'review_body',
  'body',
  'comment',
  'username',
]

const REVIEW_SUMMARY_COLUMNS = [
  'appid',
  'review_score',
  'review_score_desc',
  'total_positive',
  'total_negative',
  'total_reviews',
  'fetched_at',
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

  it('declares exactly the seventeen tables the spec names', () => {
    const tableNames = schemaTables()
      .map((t) => getTableConfig(t).name)
      .sort()
    expect(tableNames).toEqual([...EXPECTED_TABLE_NAMES].sort())
  })

  it('keeps no column anywhere that could hold review text or a reviewer identity', () => {
    for (const table of schemaTables()) {
      const { name: tableName, columns } = getTableConfig(table)
      for (const column of columns) {
        const lower = column.name.toLowerCase()
        const hit = BANNED_COLUMN_SUBSTRINGS.find((banned) => lower.includes(banned))
        expect(
          hit,
          `${tableName}.${column.name} looks like it stores review text or a reviewer identity (matched "${hit}")`,
        ).toBeUndefined()
      }
    }
  })

  it('keeps review_summary to exactly its seven aggregate columns', () => {
    const columns = getTableConfig(reviewSummary)
      .columns.map((c) => c.name)
      .sort()
    expect(columns).toEqual([...REVIEW_SUMMARY_COLUMNS].sort())
  })
})
