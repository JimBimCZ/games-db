import 'server-only'

export function parseSince(argv: string[]): number | undefined {
  const arg = argv.find((a) => a.startsWith('--since='))
  if (!arg) return undefined

  const value = arg.slice('--since='.length)
  const days = Number(value)
  if (Number.isFinite(days)) {
    // Decide here, not by falling through to `new Date(value)`: V8's legacy date-string
    // parser accepts bare small and negative numeric strings (e.g. "0", "-5") instead of
    // returning Invalid Date, which would silently turn a mistyped day count into an
    // engine-dependent timestamp.
    if (days > 0) return Math.floor(Date.now() / 1000) - days * 86400
    throw new Error(`--since expects a day count (e.g. --since=7) or an ISO date (e.g. --since=2026-08-01), got: ${value}`)
  }

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    throw new Error(`--since expects a day count (e.g. --since=7) or an ISO date (e.g. --since=2026-08-01), got: ${value}`)
  }
  return Math.floor(date.getTime() / 1000)
}
