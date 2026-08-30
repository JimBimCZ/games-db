// The divisor is read from the currency rather than fixed at 100: Steam's minor unit is
// whatever the currency's is, and JPY has none.
export function formatMinor(minor: number, currency: string): string {
  const format = new Intl.NumberFormat('en', { style: 'currency', currency })
  const digits = format.resolvedOptions().maximumFractionDigits
  return format.format(minor / 10 ** digits)
}
