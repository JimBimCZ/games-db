import DOMPurify from 'isomorphic-dompurify'
import { z } from 'zod'

export type Requirements = {
  minimum: string | null
  recommended: string | null
}

// Steam sends {} for a platform it has no data for, [] for several others, and an object with
// either or both keys otherwise.
const schema = z.object({
  minimum: z.string().optional(),
  recommended: z.string().optional(),
})

// The hydration job stores these fields without sanitising, because their HTML sits inside a
// shape it will not guess at (map-app-details.ts). Sanitising here rather than at the call
// site means no page can render them raw by forgetting to.
export function parseRequirements(raw: unknown): Requirements | null {
  const parsed = schema.safeParse(raw)
  if (!parsed.success) return null

  const minimum = parsed.data.minimum ? DOMPurify.sanitize(parsed.data.minimum) : null
  const recommended = parsed.data.recommended ? DOMPurify.sanitize(parsed.data.recommended) : null
  if (!minimum && !recommended) return null

  return { minimum, recommended }
}
