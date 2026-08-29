import { sql } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { getDb } from '@/db/client'

describe('applied migration', () => {
  it('has created every table the schema declares', async () => {
    const rows = await getDb().execute<{ table_name: string }>(
      sql`select table_name from information_schema.tables where table_schema = 'public'`,
    )
    const names = rows.rows.map((r) => r.table_name)
    for (const expected of [
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
    ]) {
      expect(names).toContain(expected)
    }
  })

  it('enforces the library status enum', async () => {
    const rows = await getDb().execute<{ enumlabel: string }>(
      sql`select enumlabel from pg_enum e
          join pg_type t on t.oid = e.enumtypid
          where t.typname = 'library_status' order by e.enumsortorder`,
    )
    expect(rows.rows.map((r) => r.enumlabel)).toEqual([
      'backlog',
      'playing',
      'finished',
      'abandoned',
      'wishlist',
    ])
  })
})
