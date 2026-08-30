import 'server-only'

export class SteamHttpError extends Error {
  // Not parameter properties: Node's strip-only type stripping (used by the sync.ts CLI
  // via `node --conditions=react-server`) can erase type annotations but not this
  // TypeScript-only constructor sugar, which emits assignment statements.
  readonly status: number
  readonly bodyPreview: string

  constructor(status: number, bodyPreview: string) {
    super(`Steam returned HTTP ${status}: ${bodyPreview.slice(0, 120)}`)
    this.name = 'SteamHttpError'
    this.status = status
    this.bodyPreview = bodyPreview
  }
}

type FetchOptions = { retries?: number; backoffMs?: number }

const RETRYABLE = new Set([429, 500, 502, 503, 504])

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export async function steamFetchJson(url: URL, opts: FetchOptions = {}): Promise<unknown> {
  const retries = opts.retries ?? 3
  const backoffMs = opts.backoffMs ?? 1000

  if (retries < 0) {
    throw new RangeError(`retries must be non-negative, got ${retries}`)
  }

  let lastError: SteamHttpError | undefined
  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await fetch(url)
    // The 403 body is HTML, so the status must be checked before any parse attempt.
    const body = await res.text()

    if (res.ok) {
      try {
        return JSON.parse(body)
      } catch {
        throw new Error(`Steam returned 200 but the body is not valid JSON: ${body.slice(0, 120)}`)
      }
    }

    lastError = new SteamHttpError(res.status, body)
    if (!RETRYABLE.has(res.status) || attempt === retries) break

    const retryAfter = Number(res.headers.get('retry-after'))
    await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : backoffMs * 2 ** attempt)
  }

  throw lastError
}
