import 'server-only'
import DOMPurify from 'isomorphic-dompurify'
import type { game, gameMedia, price } from '@/db/schema.ts'
import type { AppDetails } from '@/server/steam/schemas.ts'

const sanitize = (html: string | null | undefined): string | null =>
  html == null ? null : DOMPurify.sanitize(html)

const MONTH_ABBREVIATIONS: Record<string, number> = {
  jan: 0,
  feb: 1,
  mar: 2,
  apr: 3,
  may: 4,
  jun: 5,
  jul: 6,
  aug: 7,
  sep: 8,
  oct: 9,
  nov: 10,
  dec: 11,
}

// Steam's release_date.date is store copy, not a date field: "10 Oct, 2007" (day-precision),
// but also "Q4 2026", "Winter 2026", "TBA 2026", "March 2026", "Coming soon" — anything short
// of a full day is common for unreleased games. The text is always stored; a parsed date is a
// bonus, and a wrong one would corrupt every release-ordered row, so anything that isn't
// exactly day-precision becomes null rather than a guess. A digit-presence test is not a shape
// check: V8's Date.parse ignores tokens it doesn't recognise and fills in missing month/day as
// January 1st, so "Winter 2026" and "TBA 2026" would both silently parse to 2026-01-01. Only a
// full-string match against the exact "D Mon[,] YYYY" shape rules those out. Date.parse also
// parses this non-ISO shape in the local timezone, which would store a different instant on a
// dev machine than in the UTC container for any date within a few hours of local midnight — so
// the matched day/month/year are assembled with Date.UTC instead of handed back to Date.parse.
const RELEASE_DATE_RE = /^(\d{1,2}) ([A-Za-z]{3,9}),? (\d{4})$/

export function parseReleaseDate(text: string): Date | null {
  const match = RELEASE_DATE_RE.exec(text)
  if (!match) return null
  const [, dayText, monthText, yearText] = match
  if (dayText === undefined || monthText === undefined || yearText === undefined) return null

  const month = MONTH_ABBREVIATIONS[monthText.slice(0, 3).toLowerCase()]
  if (month === undefined) return null

  const day = Number(dayText)
  const year = Number(yearText)
  if (year < 1990 || year > 2100) return null

  const date = new Date(Date.UTC(year, month, day))
  // Date.UTC silently rolls invalid components over (day 31 in a 30-day month becomes day 1 of
  // the next), which would produce a wrong-but-plausible date rather than an obviously bad one;
  // round-tripping the components catches that instead of storing the rollover.
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month || date.getUTCDate() !== day) {
    return null
  }
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
    supportedLanguagesRaw: sanitize(data.supported_languages),
    contentDescriptorIds: data.content_descriptors?.ids ?? null,
    contentDescriptorNotes: data.content_descriptors?.notes ?? null,
    dlcAppids: data.dlc ?? null,
    // pc/mac/linux_requirements are z.unknown() in the schema because Steam returns them as
    // either an object or an empty array depending on the app (an object on three fixtures, an
    // array on appdetails-323180.json); the jsonb columns store whatever shape arrives without
    // narrowing it here. They are stored EXACTLY as Steam sent them and are NOT run through
    // sanitize() — their embedded HTML (min/recommended requirement text) lives inside an
    // unknown shape, and walking that shape to find and sanitise it would put shape-guessing
    // machinery in this mapper. This is a deliberate exemption, not an oversight: any renderer
    // that puts these fields on the page MUST sanitise them at render time.
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
