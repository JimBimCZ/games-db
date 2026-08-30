import 'server-only'
import { and, asc, desc, eq } from 'drizzle-orm'
import { connection } from 'next/server'
import { getDb } from '../../db/client.ts'
import {
  category,
  game,
  gameCategory,
  gameGenre,
  gameMedia,
  genre,
  price,
} from '../../db/schema.ts'
import { serverEnv } from '../env.ts'

export type DetailMedia = {
  kind: 'screenshot' | 'movie'
  position: number
  name: string | null
  thumbnailUrl: string | null
  fullUrl: string | null
  hlsUrl: string | null
}

export type GameDetail = Awaited<ReturnType<typeof gameDetailFull>>

// Mirrors browse's connection() guard: without it these run during the build's prerender
// pass, where there is no DATABASE_URL.
async function detailDb() {
  await connection()
  return getDb()
}

export async function gameDetailFull(appid: number) {
  const cc = serverEnv().steamCountryCode
  const db = await detailDb()

  const [row] = await db
    .select({
      appid: game.appid,
      name: game.name,
      type: game.type,
      isFree: game.isFree,
      shortDescription: game.shortDescription,
      aboutHtml: game.aboutHtml,
      headerImage: game.headerImage,
      backgroundRaw: game.backgroundRaw,
      releaseDateText: game.releaseDateText,
      releaseComingSoon: game.releaseComingSoon,
      developers: game.developers,
      publishers: game.publishers,
      platforms: game.platforms,
      metacriticScore: game.metacriticScore,
      metacriticUrl: game.metacriticUrl,
      recommendationsTotal: game.recommendationsTotal,
      achievementsTotal: game.achievementsTotal,
      currency: price.currency,
      initialMinor: price.initialMinor,
      finalMinor: price.finalMinor,
      discountPercent: price.discountPercent,
    })
    .from(game)
    .leftJoin(price, and(eq(price.appid, game.appid), eq(price.cc, cc)))
    .where(eq(game.appid, appid))
    .limit(1)

  if (!row) return null

  const [media, genres, categories] = await Promise.all([
    db
      .select({
        kind: gameMedia.kind,
        position: gameMedia.position,
        name: gameMedia.name,
        thumbnailUrl: gameMedia.thumbnailUrl,
        fullUrl: gameMedia.fullUrl,
        hlsUrl: gameMedia.hlsUrl,
      })
      .from(gameMedia)
      .where(eq(gameMedia.appid, appid))
      // media_kind is declared ('screenshot', 'movie'), so descending is what puts
      // trailers ahead of screenshots.
      .orderBy(desc(gameMedia.kind), asc(gameMedia.position)),
    db
      .select({ description: genre.description })
      .from(gameGenre)
      .innerJoin(genre, eq(genre.id, gameGenre.genreId))
      .where(eq(gameGenre.appid, appid))
      .orderBy(genre.description),
    db
      .select({ description: category.description })
      .from(gameCategory)
      .innerJoin(category, eq(category.id, gameCategory.categoryId))
      .where(eq(gameCategory.appid, appid))
      .orderBy(category.description),
  ])

  const { currency, initialMinor, finalMinor, discountPercent, ...detail } = row
  const priced =
    currency !== null && initialMinor !== null && finalMinor !== null && discountPercent !== null

  return {
    ...detail,
    price: priced ? { currency, initialMinor, finalMinor, discountPercent } : null,
    media: media as DetailMedia[],
    genres: genres.map((g) => g.description),
    categories: categories.map((c) => c.description),
  }
}
