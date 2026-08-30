import 'server-only'
import { and, asc, desc, eq, type SQL } from 'drizzle-orm'
import { connection } from 'next/server'
import { cache } from 'react'
import { getDb } from '../../db/client.ts'
import { game, libraryEntry, libraryStatusEvent, price } from '../../db/schema.ts'
import type { LibraryStatus } from '../../lib/library/statuses.ts'
import { currentUserId } from '../auth/current-user.ts'
import { serverEnv } from '../env.ts'
import { LIBRARY_ROW_LIMIT, type SortDir, type SortKey } from './params.ts'

async function libraryDb() {
  await connection()
  return getDb()
}

export const libraryStatusMap = cache(
  async (): Promise<Map<number, LibraryStatus> | null> => {
    const userId = await currentUserId()
    if (!userId) return null

    const db = await libraryDb()
    const rows = await db
      .select({ appid: libraryEntry.appid, status: libraryEntry.status })
      .from(libraryEntry)
      .where(eq(libraryEntry.userId, userId))

    return new Map(rows.map((row) => [row.appid, row.status]))
  },
)

export type LibraryEntryDetail = {
  status: LibraryStatus
  statusSince: Date | null
  priceSeenMinor: number | null
  priceSeenCurrency: string | null
}

export async function libraryEntryFor(appid: number): Promise<LibraryEntryDetail | null> {
  const userId = await currentUserId()
  if (!userId) return null

  const db = await libraryDb()
  const [entry] = await db
    .select({
      id: libraryEntry.id,
      status: libraryEntry.status,
      priceSeenMinor: libraryEntry.priceSeenMinor,
      priceSeenCurrency: libraryEntry.priceSeenCurrency,
    })
    .from(libraryEntry)
    .where(and(eq(libraryEntry.userId, userId), eq(libraryEntry.appid, appid)))

  if (!entry) return null

  const [event] = await db
    .select({ at: libraryStatusEvent.at })
    .from(libraryStatusEvent)
    .where(
      and(
        eq(libraryStatusEvent.entryId, entry.id),
        eq(libraryStatusEvent.status, entry.status),
      ),
    )
    .orderBy(desc(libraryStatusEvent.at))
    .limit(1)

  return {
    status: entry.status,
    statusSince: event?.at ?? null,
    priceSeenMinor: entry.priceSeenMinor,
    priceSeenCurrency: entry.priceSeenCurrency,
  }
}

export type LibraryRow = {
  appid: number
  name: string | null
  capsuleImage: string | null
  headerImage: string | null
  status: LibraryStatus
  addedAt: Date
  priceSeenMinor: number | null
  priceSeenCurrency: string | null
  currency: string | null
  initialMinor: number | null
  finalMinor: number | null
  discountPercent: number | null
}

function orderFor(sort: SortKey, dir: SortDir): SQL {
  const direction = dir === 'asc' ? asc : desc
  switch (sort) {
    case 'name':
      return direction(game.name)
    case 'price':
      return direction(price.finalMinor)
    case 'status':
      return direction(libraryEntry.status)
    case 'added':
      return direction(libraryEntry.addedAt)
  }
}

export async function libraryRows(
  status: LibraryStatus | null,
  sort: SortKey,
  dir: SortDir,
): Promise<LibraryRow[] | null> {
  const userId = await currentUserId()
  if (!userId) return null

  const cc = serverEnv().steamCountryCode
  const db = await libraryDb()

  // Left joins throughout: library_entry has no foreign key on appid, so an entry can
  // outlive the game row that described it, and 290 of 552 games carry no price row.
  return db
    .select({
      appid: libraryEntry.appid,
      name: game.name,
      capsuleImage: game.capsuleImage,
      headerImage: game.headerImage,
      status: libraryEntry.status,
      addedAt: libraryEntry.addedAt,
      priceSeenMinor: libraryEntry.priceSeenMinor,
      priceSeenCurrency: libraryEntry.priceSeenCurrency,
      currency: price.currency,
      initialMinor: price.initialMinor,
      finalMinor: price.finalMinor,
      discountPercent: price.discountPercent,
    })
    .from(libraryEntry)
    .leftJoin(game, eq(game.appid, libraryEntry.appid))
    .leftJoin(price, and(eq(price.appid, libraryEntry.appid), eq(price.cc, cc)))
    .where(
      status
        ? and(eq(libraryEntry.userId, userId), eq(libraryEntry.status, status))
        : eq(libraryEntry.userId, userId),
    )
    .orderBy(orderFor(sort, dir))
    .limit(LIBRARY_ROW_LIMIT)
}
