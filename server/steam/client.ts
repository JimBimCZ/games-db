import 'server-only'
import { limiterForHost } from './limiter.ts'

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
    // A large error body (observed: 500 KB) must not be retained in full — logging the
    // error object serializes this property, and an unbounded one would defeat the point.
    this.bodyPreview = bodyPreview.slice(0, 500)
  }
}

type FetchOptions = { retries?: number; backoffMs?: number; timeoutMs?: number }

const RETRYABLE = new Set([429, 500, 502, 503, 504])

// An uncapped Retry-After would let a misbehaving or malicious response (e.g. 86400)
// silently stall a job for a day.
const MAX_RETRY_AFTER_MS = 60_000

const DEFAULT_TIMEOUT_MS = 20_000

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export async function steamFetchJson(url: URL, opts: FetchOptions = {}): Promise<unknown> {
  const retries = opts.retries ?? 3
  const backoffMs = opts.backoffMs ?? 1000

  if (retries < 0) {
    throw new RangeError(`retries must be non-negative, got ${retries}`)
  }

  let lastError: Error | undefined
  for (let attempt = 0; attempt <= retries; attempt++) {
    // Outside the try: a malformed STEAM_STOREFRONT_RPS is a config error, not a network
    // fault, and must fail immediately rather than burn three retries' worth of backoff.
    await limiterForHost(url.hostname).acquire()

    let res: Response
    let body: string
    try {
      // A thrown network fault (DNS failure, ECONNRESET) must be retried like a 5xx
      // rather than escaping the loop and aborting a job with no resume point. A timeout
      // abort surfaces here the same way, since AbortSignal makes fetch reject — but only
      // while headers are in flight. fetch() resolves once headers arrive and the signal
      // stays live while the body streams, so the body read has to stay inside this same
      // try or a timeout firing mid-body throws past the loop as a bare, unretried
      // DOMException.
      res = await fetch(url, { signal: AbortSignal.timeout(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS) })
      // The 403 body is HTML, so the status must be checked before any parse attempt.
      body = await res.text()
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err))
      if (attempt === retries) break
      await sleep(backoffMs * 2 ** attempt)
      continue
    }

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
    const retryAfterMs = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : undefined
    await sleep(retryAfterMs !== undefined ? Math.min(retryAfterMs, MAX_RETRY_AFTER_MS) : backoffMs * 2 ** attempt)
  }

  throw lastError
}
