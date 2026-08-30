import 'server-only'
import DOMPurify from 'isomorphic-dompurify'
import type { game, gameMedia, price } from '@/db/schema.ts'
import type { AppDetails } from '@/server/steam/schemas.ts'

const sanitize = (html: string | undefined): string | null =>
  html === undefined ? null : DOMPurify.sanitize(html)

// Steam's release_date.date is store copy, not a date field: "10 Oct, 2007", "Q4 2026",
// "Coming soon". The text is always stored; a parsed date is a bonus, and a wrong one would
// corrupt every release-ordered row, so anything ambiguous becomes null. Date.parse accepts a
// lot of nonsense on V8, so a bare year-digit check plus a plausible-year range guard is
// deliberate, not decorative.
export function parseReleaseDate(text: string): Date | null {
  if (!/\d{4}/.test(text)) return null
  const parsed = Date.parse(text)
  if (Number.isNaN(parsed)) return null
  const date = new Date(parsed)
  if (date.getUTCFullYear() < 1990 || date.getUTCFullYear() > 2100) return null
  return date
}

export function mapGameRow(data: AppDetails, fetchedAt: Date): typeof game.$inferInsert {
  const release = data.release_date
  return {
    appid: data.steam_appid,
    name: data.name,
    type: data.type,
    isFree: data.is_free,
    shortDescription: data.short_description ?? null,
    aboutHtml: sanitize(data.about_the_game),
    detailedHtml: sanitize(data.detailed_description),
    headerImage: data.header_image ?? null,
    capsuleImage: data.capsule_image ?? null,
    backgroundRaw: data.background_raw ?? null,
    releaseDateText: release?.date ?? null,
    releaseComingSoon: release?.coming_soon ?? false,
    releaseDate: release?.date ? parseReleaseDate(release.date) : null,
    developers: data.developers ?? null,
    publishers: data.publishers ?? null,
    platforms: data.platforms ?? null,
    metacriticScore: data.metacritic?.score ?? null,
    metacriticUrl: data.metacritic?.url ?? null,
    recommendationsTotal: data.recommendations?.total ?? null,
    achievementsTotal: data.achievements?.total ?? null,
    supportedLanguagesRaw: data.supported_languages ?? null,
    contentDescriptorIds: data.content_descriptors?.ids ?? null,
    contentDescriptorNotes: data.content_descriptors?.notes ?? null,
    dlcAppids: data.dlc ?? null,
    // pc/mac/linux_requirements are z.unknown() in the schema because Steam returns them as
    // either an object or an empty array depending on the app; the jsonb columns store
    // whatever shape arrives without narrowing it here.
    pcRequirements: data.pc_requirements ?? null,
    macRequirements: data.mac_requirements ?? null,
    linuxRequirements: data.linux_requirements ?? null,
    fetchedAt,
  }
}

export function mapMediaRows(data: AppDetails): Omit<typeof gameMedia.$inferInsert, 'id'>[] {
  const rows: Omit<typeof gameMedia.$inferInsert, 'id'>[] = []

  data.screenshots?.forEach((s, position) => {
    rows.push({
      appid: data.steam_appid,
      kind: 'screenshot',
      position,
      steamMediaId: s.id ?? null,
      name: null,
      thumbnailUrl: s.path_thumbnail ?? null,
      fullUrl: s.path_full ?? null,
      hlsUrl: null,
      dashH264Url: null,
      dashAv1Url: null,
      highlight: false,
    })
  })

  // movies[] carries no mp4 or webm — only DASH manifests and an HLS playlist. The URLs are
  // read from the payload; capsule and media paths contain a per-app hash and cannot be
  // constructed from the appid.
  data.movies?.forEach((m, position) => {
    rows.push({
      appid: data.steam_appid,
      kind: 'movie',
      position,
      steamMediaId: m.id ?? null,
      name: m.name ?? null,
      thumbnailUrl: m.thumbnail ?? null,
      fullUrl: null,
      hlsUrl: m.hls_h264 ?? null,
      dashH264Url: m.dash_h264 ?? null,
      dashAv1Url: m.dash_av1 ?? null,
      highlight: m.highlight ?? false,
    })
  })

  return rows
}

export function mapPriceRow(
  data: AppDetails,
  cc: string,
  fetchedAt: Date,
): typeof price.$inferInsert | null {
  const p = data.price_overview
  if (!p) return null
  return {
    appid: data.steam_appid,
    cc,
    currency: p.currency,
    initialMinor: p.initial,
    finalMinor: p.final,
    discountPercent: p.discount_percent,
    fetchedAt,
  }
}
