import { formatMinor } from './price.ts'

export type PriceDelta = { direction: 'down' | 'up'; label: string }

export function priceDelta(
  seenMinor: number | null,
  seenCurrency: string | null,
  currentMinor: number | null,
  currentCurrency: string | null,
): PriceDelta | null {
  if (seenMinor === null || currentMinor === null) return null
  // Comparing across currencies would mean converting, which we never do.
  if (seenCurrency === null || seenCurrency !== currentCurrency) return null
  if (seenMinor === currentMinor) return null

  const difference = Math.abs(currentMinor - seenMinor)
  return {
    direction: currentMinor < seenMinor ? 'down' : 'up',
    label: formatMinor(difference, currentCurrency),
  }
}
