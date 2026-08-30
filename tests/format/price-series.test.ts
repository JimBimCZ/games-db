import { describe, expect, it } from 'vitest'
import { buildPriceSeries } from '@/lib/format/price-series'

const at = (iso: string, finalMinor: number) => ({
  observedAt: new Date(iso),
  finalMinor,
  currency: 'EUR',
})

describe('buildPriceSeries', () => {
  // 260 of 262 priced games have fewer than two observations. A one-point "chart" is a dot
  // that implies a trend nobody measured.
  it('refuses to plot fewer than two observations', () => {
    expect(buildPriceSeries([])).toBeNull()
    expect(buildPriceSeries([at('2026-08-30T11:13:00Z', 1999)])).toBeNull()
  })

  // The only appid in the database with two history rows stores them identical in every
  // field but the timestamp. A flat line between two points on the same day is not history.
  it('refuses to plot observations that never moved', () => {
    expect(
      buildPriceSeries([at('2026-08-30T11:14:54Z', 975), at('2026-08-30T11:24:01Z', 975)]),
    ).toBeNull()
  })

  it('orders points oldest first regardless of input order', () => {
    const series = buildPriceSeries([
      at('2026-08-30T12:53:00Z', 999),
      at('2026-08-30T11:13:00Z', 1999),
    ])
    expect(series?.points.map((p) => p.finalMinor)).toEqual([1999, 999])
  })

  it('reports the range the chart has to span', () => {
    const series = buildPriceSeries([
      at('2026-08-30T11:13:00Z', 1999),
      at('2026-08-30T12:00:00Z', 599),
      at('2026-08-30T12:53:00Z', 999),
    ])
    expect(series?.minMinor).toBe(599)
    expect(series?.maxMinor).toBe(1999)
    expect(series?.currency).toBe('EUR')
  })
})
