import 'server-only'
import { and, eq, sql } from 'drizzle-orm'
import { connection } from 'next/server'
import { getDb } from '../../db/client.ts'
import { game, gameGenre, genre, price, steamList, steamListKind } from '../../db/schema.ts'
import { serverEnv } from '../env.ts'
import { GENRE_PAGE_SIZE, MIN_GENRE_GAMES, SEARCH_LIMIT } from './params.ts'

// Derived from the schema enum rather than imported from server/steam: browse must not
// depend on the Steam client, so no browse path can ever fan out to Steam.
export type ListKind = (typeof steamListKind.enumValues)[number]

export type GameCard = {
  appid: number
  name: string
  headerImage: string | null
  capsuleImage: string | null
  shortDescription: string | null
  releaseDateText: string | null
  releaseComingSoon: boolean
  isFree: boolean
  price: {
    currency: string
    initialMinor: number
    finalMinor: number
    discountPercent: number
  } | null
}

export type CardRow = {
  appid: number
  name: string
  headerImage: string | null
  capsuleImage: string | null
  shortDescription: string | null
  releaseDateText: string | null
  releaseComingSoon: boolean
  isFree: boolean
  currency: string | null
  initialMinor: number | null
  finalMinor: number | null
  discountPercent: number | null
}

const cardColumns = {
  appid: game.appid,
  name: game.name,
  headerImage: game.headerImage,
  capsuleImage: game.capsuleImage,
  shortDescription: game.shortDescription,
  releaseDateText: game.releaseDateText,
  releaseComingSoon: game.releaseComingSoon,
  isFree: game.isFree,
  currency: price.currency,
  initialMinor: price.initialMinor,
  finalMinor: price.finalMinor,
  discountPercent: price.discountPercent,
}

export function toGameCard(row: CardRow): GameCard {
  const priced =
    row.currency !== null &&
    row.initialMinor !== null &&
    row.finalMinor !== null &&
    row.discountPercent !== null

  return {
    appid: row.appid,
    name: row.name,
    headerImage: row.headerImage,
    capsuleImage: row.capsuleImage,
    shortDescription: row.shortDescription,
    releaseDateText: row.releaseDateText,
    releaseComingSoon: row.releaseComingSoon,
    isFree: row.isFree,
    price: priced
      ? {
          currency: row.currency as string,
          initialMinor: row.initialMinor as number,
          finalMinor: row.finalMinor as number,
          discountPercent: row.discountPercent as number,
        }
      : null,
  }
}

// Browse renders from the database on every request, so connection() holds these queries
// back until one arrives. Without it Next runs them during the build's prerender pass, where
// there is no DATABASE_URL — and because the sidebar queries genres, that pass covers every
// route, failing both CI and the Docker build stage.
async function browseDb() {
  await connection()
  return getDb()
}

function countryCode() {
  return serverEnv().steamCountryCode
}

// Inner join to game: sync:lists can name an appid hydration has not reached, and a page of
// 97 beats a page with three broken holes.
export async function listCards(kind: ListKind, limit: number): Promise<GameCard[]> {
  const cc = countryCode()
  const db = await browseDb()
  const rows = await db
    .select(cardColumns)
    .from(steamList)
    .innerJoin(game, eq(game.appid, steamList.appid))
    .leftJoin(price, and(eq(price.appid, game.appid), eq(price.cc, cc)))
    .where(eq(steamList.kind, kind))
    .orderBy(steamList.rank)
    .limit(limit)
  return rows.map(toGameCard)
}

// Fetches one row beyond the page so "next" can be decided without a second count query.
export async function genreCards(
  genreId: string,
  page: number,
): Promise<{ cards: GameCard[]; hasNext: boolean }> {
  const cc = countryCode()
  const db = await browseDb()
  const rows = await db
    .select(cardColumns)
    .from(game)
    .innerJoin(gameGenre, eq(gameGenre.appid, game.appid))
    .leftJoin(price, and(eq(price.appid, game.appid), eq(price.cc, cc)))
    .where(eq(gameGenre.genreId, genreId))
    .orderBy(sql`${game.releaseDate} desc nulls last`, game.name)
    .limit(GENRE_PAGE_SIZE + 1)
    .offset((page - 1) * GENRE_PAGE_SIZE)

  return {
    cards: rows.slice(0, GENRE_PAGE_SIZE).map(toGameCard),
    hasNext: rows.length > GENRE_PAGE_SIZE,
  }
}

export async function genreById(id: string) {
  const db = await browseDb()
  const [row] = await db
    .select({ id: genre.id, description: genre.description })
    .from(genre)
    .where(eq(genre.id, id))
    .limit(1)
  return row ?? null
}

export async function sidebarGenres() {
  const db = await browseDb()
  return db
    .select({ id: genre.id, description: genre.description })
    .from(genre)
    .innerJoin(gameGenre, eq(gameGenre.genreId, genre.id))
    .groupBy(genre.id, genre.description)
    .having(sql`count(*) >= ${MIN_GENRE_GAMES}`)
    .orderBy(genre.description)
}

// similarity() orders; the GIN trigram index is what makes the leading-wildcard ilike
// something other than a sequential scan.
export async function searchCards(q: string): Promise<GameCard[]> {
  const cc = countryCode()
  // % and _ are ilike wildcards; escape them in the match pattern so a literal search term
  // like "do_a" doesn't match "Dota 2". similarity() still scores against the raw term.
  const pattern = `%${q.replace(/[\\%_]/g, (char) => `\\${char}`)}%`
  const db = await browseDb()
  const rows = await db
    .select(cardColumns)
    .from(game)
    .leftJoin(price, and(eq(price.appid, game.appid), eq(price.cc, cc)))
    .where(sql`${game.name} ilike ${pattern} escape '\\'`)
    .orderBy(sql`similarity(${game.name}, ${q}) desc`, game.name)
    .limit(SEARCH_LIMIT)
  return rows.map(toGameCard)
}
