import { z } from 'zod'

export type RequirementLine = { label: string | null; value: string }

export type Requirements = {
  minimum: RequirementLine[] | null
  recommended: RequirementLine[] | null
}

// Steam sends {} for a platform it has no data for, [] for several others, and an object with
// either or both keys otherwise.
const schema = z.object({
  minimum: z.string().optional(),
  recommended: z.string().optional(),
})

// The 194 &amp;, 131 &reg;, 76 &quot; and 19 &trade; in the stored blocks are every named
// entity Steam actually uses; numeric references are decoded generically below.
const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  apos: "'",
  copy: '©',
  gt: '>',
  lt: '<',
  nbsp: ' ',
  quot: '"',
  reg: '®',
  trade: '™',
}

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (entity, body: string) => {
    if (!body.startsWith('#')) return NAMED_ENTITIES[body.toLowerCase()] ?? entity
    const code =
      body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : Number(body.slice(1))
    return Number.isInteger(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : entity
  })
}

function toText(html: string): string {
  return decodeEntities(html.replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim()
}

// A label opens the item, optionally behind the wrapper tags Steam nests it in, and the colon
// falls on either side of </strong> depending on the app.
const LEADING_LABEL = /^(?:\s|<(?!strong\b)[^>]*>)*<strong\b[^>]*>([\s\S]*?)<\/strong>\s*:?/i

function toLine(item: string, kind: 'minimum' | 'recommended'): RequirementLine | null {
  const match = item.match(LEADING_LABEL)
  const value = toText(match ? item.slice(match[0].length) : item)
  if (!value) return null

  const label = match ? toText(match[1] ?? '').replace(/:$/, '') : ''
  const repeatsHeading = new RegExp(`^${kind}( system)?( requirements)?$`, 'i').test(label)

  return { label: label && !repeatsHeading ? label : null, value }
}

function toLines(block: string, kind: 'minimum' | 'recommended'): RequirementLine[] | null {
  // Tags are stripped rather than rendered, so script and style bodies have to go with their
  // tags — stripping the tags alone would leave the script source behind as visible prose.
  const stripped = block.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ')

  // 14,489 of 14,601 stored minimum blocks are a <ul> of <li>; the rest are a paragraph of
  // prose broken by <br>, and a handful of those carry both halves in the minimum field.
  const items = stripped.match(/<li\b[^>]*>[\s\S]*?(?:<\/li\s*>|$)/gi) ?? stripped.split(/<br\b[^>]*>|<\/p\s*>/i)

  const lines = items.map((item) => toLine(item, kind)).filter((line) => line !== null)
  return lines.length > 0 ? lines : null
}

// The hydration job stores these fields exactly as Steam sent them (map-app-details.ts).
// Parsing them into lines here, rather than sanitising markup for a renderer to inject, is
// what keeps a DOM-based sanitiser — and the jsdom tree behind it — off the request path.
export function parseRequirements(raw: unknown): Requirements | null {
  const parsed = schema.safeParse(raw)
  if (!parsed.success) return null

  const minimum = parsed.data.minimum ? toLines(parsed.data.minimum, 'minimum') : null
  const recommended = parsed.data.recommended ? toLines(parsed.data.recommended, 'recommended') : null
  if (!minimum && !recommended) return null

  return { minimum, recommended }
}
