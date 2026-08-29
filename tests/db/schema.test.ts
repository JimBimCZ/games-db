import { getTableConfig } from 'drizzle-orm/pg-core'
import { describe, expect, it } from 'vitest'
import { libraryEntry, libraryStatus, price, reviewSummary } from '@/db/schema'

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

  it('keeps no column that could hold review text or a reviewer identity', () => {
    const columns = getTableConfig(reviewSummary).columns.map((c) => c.name)
    expect(columns).not.toContain('review')
    expect(columns).not.toContain('author_steamid')
    expect(columns).not.toContain('personaname')
  })
})
