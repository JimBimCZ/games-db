import 'server-only'

export type Limiter = { acquire: () => Promise<void> }

export function createLimiter(ratePerSecond: number): Limiter {
  if (!(ratePerSecond > 0)) {
    throw new RangeError(`ratePerSecond must be positive, got ${ratePerSecond}`)
  }
  const intervalMs = 1000 / ratePerSecond
  let nextSlot = 0

  return {
    async acquire() {
      const now = Date.now()
      // Reserving the slot before awaiting is what serialises concurrent callers: two
      // acquire() calls in the same tick take consecutive slots rather than the same one.
      const slot = Math.max(now, nextSlot)
      nextSlot = slot + intervalMs
      const waitMs = slot - now
      if (waitMs > 0) await new Promise((r) => setTimeout(r, waitMs))
    },
  }
}

// api.steampowered.com and store.steampowered.com are different hosts with different
// behaviour: the M2 sync moves 245k appids through the former in 18 seconds, while the
// latter is the constrained one. A single global limiter would slow the sync to
// storefront speed for no reason.
const STOREFRONT_HOST = 'store.steampowered.com'
// TODO: unmeasured. The M2 sync only establishes that 6 requests over ~18s (0.33 req/s)
// is safe for IStoreService/GetAppList; run a ramp against api.steampowered.com like the
// one in docs/superpowers/specs/2026-08-30-m3-observations.md §2 before trusting this
// number, and update this comment with the measurement.
const WEB_API_RATE = 5

const limiters = new Map<string, Limiter>()

export function limiterForHost(hostname: string): Limiter {
  const existing = limiters.get(hostname)
  if (existing) return existing

  const rate = hostname === STOREFRONT_HOST ? storefrontRate() : WEB_API_RATE
  const created = createLimiter(rate)
  limiters.set(hostname, created)
  return created
}

export function resetLimitersForTest(): void {
  limiters.clear()
}

function storefrontRate(): number {
  const raw = process.env.STEAM_STOREFRONT_RPS
  if (raw === undefined) return DEFAULT_STOREFRONT_RPS
  const parsed = Number(raw)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new RangeError(`STEAM_STOREFRONT_RPS must be a positive number, got: ${raw}`)
  }
  return parsed
}

// 65% of the highest rate observed without a 429 (1.86 req/s sustained over 40 requests;
// 200 requests in 203.6s hit no limit at all). That measurement is a floor, not a ceiling —
// the probe stopped rather than climbing until Steam refused. See
// docs/superpowers/specs/2026-08-30-m3-observations.md §2.
export const DEFAULT_STOREFRONT_RPS = 1.2
