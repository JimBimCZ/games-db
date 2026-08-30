export type PriceObservation = {
  observedAt: Date
  finalMinor: number
  currency: string
}

export type PriceSeries = {
  points: PriceObservation[]
  minMinor: number
  maxMinor: number
  currency: string
}

// Two observations is the minimum that describes a change. Below that there is a price, which
// the price card already shows, but no history to draw.
export function buildPriceSeries(rows: PriceObservation[]): PriceSeries | null {
  if (rows.length < 2) return null

  const points = [...rows].sort((a, b) => a.observedAt.getTime() - b.observedAt.getTime())
  const [first] = points
  if (!first) return null

  const amounts = points.map((p) => p.finalMinor)
  const minMinor = Math.min(...amounts)
  const maxMinor = Math.max(...amounts)

  // Repeated observations of an unchanged price are not a history. appid 620 stores two rows
  // identical in every field but the timestamp, and drawing a flat line between two points on
  // the same day claims a trend that was never measured.
  if (minMinor === maxMinor) return null

  return {
    points,
    minMinor,
    maxMinor,
    // Read from the rows, never assumed: cc=cz is priced in EUR, not CZK.
    currency: first.currency,
  }
}
