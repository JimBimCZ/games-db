import 'server-only'
import { z } from 'zod'

export class SteamParseError extends Error {
  readonly appid: number | undefined
  readonly issues: string

  constructor(message: string, appid: number | undefined, issues: string) {
    super(message)
    this.name = 'SteamParseError'
    this.appid = appid
    this.issues = issues
  }
}

const priceOverviewSchema = z.object({
  currency: z.string(),
  initial: z.number().int(),
  final: z.number().int(),
  // Required, not defaulted: a missing discount_percent defaulting to 0 would make a genuine
  // sale look full-price instead of surfacing as a parse failure.
  discount_percent: z.number().int(),
})

const screenshotSchema = z.object({
  id: z.number().int(),
  path_thumbnail: z.string(),
  path_full: z.string(),
})

const movieSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  thumbnail: z.string(),
  highlight: z.boolean(),
  // Observed live: these are plain URL strings, not per-quality variant objects, and no mp4
  // or webm key appears at all. See docs/superpowers/specs/2026-08-30-m3-observations.md §1a.
  // Kept optional, unlike the rest of this schema: a movie missing one codec is plausible and
  // unproven either way from a four-app sample.
  hls_h264: z.string().optional(),
  dash_h264: z.string().optional(),
  dash_av1: z.string().optional(),
})

const appDetailsDataSchema = z.object({
  steam_appid: z.number().int(),
  type: z.string(),
  name: z.string(),
  // Required, not defaulted: a missing is_free defaulting to false would make a genuine free
  // game look paid instead of surfacing as a parse failure.
  is_free: z.boolean(),
  short_description: z.string().optional(),
  about_the_game: z.string().optional(),
  detailed_description: z.string().optional(),
  header_image: z.string().optional(),
  capsule_image: z.string().optional(),
  background_raw: z.string().optional(),
  // coming_soon and date required, not defaulted: a missing coming_soon defaulting to false
  // would make an unreleased game look released. An empty date string still parses honestly;
  // it is the coming_soon default that would silently lie.
  release_date: z.object({ coming_soon: z.boolean(), date: z.string() }).optional(),
  developers: z.array(z.string()).optional(),
  publishers: z.array(z.string()).optional(),
  platforms: z.object({ windows: z.boolean(), mac: z.boolean(), linux: z.boolean() }).optional(),
  metacritic: z.object({ score: z.number().int(), url: z.string() }).optional(),
  recommendations: z.object({ total: z.number().int() }).optional(),
  achievements: z.object({ total: z.number().int() }).optional(),
  supported_languages: z.string().optional(),
  content_descriptors: z
    .object({ ids: z.array(z.number().int()).default([]), notes: z.string().nullable().optional() })
    .optional(),
  dlc: z.array(z.number().int()).optional(),
  price_overview: priceOverviewSchema.optional(),
  genres: z.array(z.object({ id: z.string(), description: z.string() })).optional(),
  categories: z.array(z.object({ id: z.number().int(), description: z.string() })).optional(),
  screenshots: z.array(screenshotSchema).optional(),
  movies: z.array(movieSchema).optional(),
  // Observed as both an object with minimum/recommended HTML and an empty array, so it is
  // stored as-is in a jsonb column rather than given a shape it does not always have.
  pc_requirements: z.unknown().optional(),
  mac_requirements: z.unknown().optional(),
  linux_requirements: z.unknown().optional(),
})

export type AppDetails = z.infer<typeof appDetailsDataSchema>

const envelopeSchema = z.record(
  z.string(),
  z.object({ success: z.boolean(), data: z.unknown().optional() }),
)

export type AppDetailsResult = { kind: 'ok'; data: AppDetails } | { kind: 'unavailable' }

export function parseAppDetails(raw: unknown, appid: number): AppDetailsResult {
  const envelope = envelopeSchema.safeParse(raw)
  if (!envelope.success) {
    throw new SteamParseError(
      `appdetails envelope did not parse for appid ${appid}`,
      appid,
      z.prettifyError(envelope.error),
    )
  }

  const entry = envelope.data[String(appid)]
  // A payload keyed by a different appid is not ours to write: appdetails redirects some
  // appids to their base game, and writing that payload under the requested appid would
  // silently duplicate one game across two rows.
  // entry.data == null (loose) catches both a missing key and an explicit null: delisted and
  // region-locked apps can return either, and both are the normal "no data" case, not a shape
  // change.
  if (!entry || !entry.success || entry.data == null) return { kind: 'unavailable' }

  const parsed = appDetailsDataSchema.safeParse(entry.data)
  if (!parsed.success) {
    throw new SteamParseError(
      `appdetails data did not parse for appid ${appid}: ${z.prettifyError(parsed.error)}`,
      appid,
      z.prettifyError(parsed.error),
    )
  }
  if (parsed.data.steam_appid !== appid) return { kind: 'unavailable' }

  return { kind: 'ok', data: parsed.data }
}

export type PriceOverview = {
  currency: string
  initialMinor: number
  finalMinor: number
  discountPercent: number
}

export function parsePriceOverviewBatch(raw: unknown): Map<number, PriceOverview | null> {
  const envelope = envelopeSchema.safeParse(raw)
  if (!envelope.success) {
    throw new SteamParseError(
      'price_overview batch envelope did not parse',
      undefined,
      z.prettifyError(envelope.error),
    )
  }

  const out = new Map<number, PriceOverview | null>()
  for (const [key, entry] of Object.entries(envelope.data)) {
    const appid = Number(key)
    if (!Number.isInteger(appid)) continue

    // Free games return "data": [] — an empty array, not an object. entry.data == null
    // (loose) catches both a missing key and an explicit null, the normal delisted/region-locked
    // case, not a shape change.
    if (!entry.success || entry.data == null || Array.isArray(entry.data)) {
      out.set(appid, null)
      continue
    }

    const parsed = z.object({ price_overview: priceOverviewSchema.optional() }).safeParse(entry.data)
    if (!parsed.success) {
      throw new SteamParseError(
        `price_overview did not parse for appid ${appid}`,
        appid,
        z.prettifyError(parsed.error),
      )
    }

    const p = parsed.data.price_overview
    out.set(
      appid,
      p
        ? {
            currency: p.currency,
            initialMinor: p.initial,
            finalMinor: p.final,
            discountPercent: p.discount_percent,
          }
        : null,
    )
  }
  return out
}

const reviewSummarySchema = z.object({
  query_summary: z.object({
    review_score: z.number().int().optional(),
    review_score_desc: z.string().optional(),
    // Required, not defaulted: db/schema.ts declares these columns nullable precisely so a
    // real absence can be stored as such, rather than a default of 0 masquerading as a
    // genuine zero-review count.
    total_positive: z.number().int(),
    total_negative: z.number().int(),
    total_reviews: z.number().int(),
  }),
})

export type ReviewSummary = {
  reviewScore: number | undefined
  reviewScoreDesc: string | undefined
  totalPositive: number
  totalNegative: number
  totalReviews: number
}

// Only the aggregate crosses this boundary. Review bodies and author identifiers are never
// fetched (num_per_page=0) and must never be added to this return type.
export function parseReviewSummary(raw: unknown): ReviewSummary {
  const parsed = reviewSummarySchema.safeParse(raw)
  if (!parsed.success) {
    throw new SteamParseError(
      'appreviews query_summary did not parse',
      undefined,
      z.prettifyError(parsed.error),
    )
  }
  const s = parsed.data.query_summary
  return {
    reviewScore: s.review_score,
    reviewScoreDesc: s.review_score_desc,
    totalPositive: s.total_positive,
    totalNegative: s.total_negative,
    totalReviews: s.total_reviews,
  }
}
