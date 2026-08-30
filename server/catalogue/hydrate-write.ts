import 'server-only'
import { and, eq, sql } from 'drizzle-orm'
import type { JobDb } from '../../db/client.ts'
import {
  category,
  game,
  gameCategory,
  gameGenre,
  gameMedia,
  genre,
  price,
  priceHistory,
} from '../../db/schema.ts'
import type { AppDetails } from '../steam/schemas.ts'
import { mapGameRow, mapMediaRows, mapPriceRow } from './map-app-details.ts'

export async function writeHydratedApp(
  db: JobDb,
  data: AppDetails,
  cc: string,
  now: Date,
): Promise<void> {
  const appid = data.steam_appid
  const gameRow = mapGameRow(data, now)
  const mediaRows = mapMediaRows(data)
  const priceRow = mapPriceRow(data, cc, now)

  await db.transaction(async (tx) => {
    await tx
      .insert(game)
      .values(gameRow)
      .onConflictDoUpdate({ target: game.appid, set: { ...gameRow, fetchedAt: now } })

    await tx.delete(gameMedia).where(eq(gameMedia.appid, appid))
    if (mediaRows.length > 0) await tx.insert(gameMedia).values(mediaRows)

    if (data.genres && data.genres.length > 0) {
      await tx
        .insert(genre)
        .values(data.genres.map((g) => ({ id: g.id, description: g.description })))
        .onConflictDoUpdate({ target: genre.id, set: { description: sql`excluded.description` } })
      await tx.delete(gameGenre).where(eq(gameGenre.appid, appid))
      await tx.insert(gameGenre).values(data.genres.map((g) => ({ appid, genreId: g.id })))
    } else {
      await tx.delete(gameGenre).where(eq(gameGenre.appid, appid))
    }

    if (data.categories && data.categories.length > 0) {
      await tx
        .insert(category)
        .values(data.categories.map((c) => ({ id: c.id, description: c.description })))
        .onConflictDoUpdate({ target: category.id, set: { description: sql`excluded.description` } })
      await tx.delete(gameCategory).where(eq(gameCategory.appid, appid))
      await tx.insert(gameCategory).values(data.categories.map((c) => ({ appid, categoryId: c.id })))
    } else {
      await tx.delete(gameCategory).where(eq(gameCategory.appid, appid))
    }

    if (priceRow) {
      const existing = await tx
        .select()
        .from(price)
        .where(and(eq(price.appid, appid), eq(price.cc, cc)))
        .limit(1)

      const previous = existing[0]
      const changed =
        !previous ||
        previous.currency !== priceRow.currency ||
        previous.initialMinor !== priceRow.initialMinor ||
        previous.finalMinor !== priceRow.finalMinor ||
        previous.discountPercent !== priceRow.discountPercent

      await tx
        .insert(price)
        .values(priceRow)
        .onConflictDoUpdate({
          target: [price.appid, price.cc],
          set: {
            currency: priceRow.currency,
            initialMinor: priceRow.initialMinor,
            finalMinor: priceRow.finalMinor,
            discountPercent: priceRow.discountPercent,
            fetchedAt: now,
          },
        })

      // price_history is the one thing here Steam cannot re-serve, so it is appended only on
      // an actual change — an unchanged observation would bloat the chart with flat points.
      if (changed) {
        await tx.insert(priceHistory).values({
          appid,
          cc,
          currency: priceRow.currency,
          initialMinor: priceRow.initialMinor,
          finalMinor: priceRow.finalMinor,
          discountPercent: priceRow.discountPercent,
          observedAt: now,
        })
      }
    }
  })
}
