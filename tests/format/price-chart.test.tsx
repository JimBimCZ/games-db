import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { PriceChartSection } from '@/components/detail/price-chart'

const at = (iso: string, finalMinor: number) => ({
  observedAt: new Date(iso),
  finalMinor,
  currency: 'EUR',
})

// No appid in the database has two price observations at different prices, so the drawing
// branch cannot be reached from a real page. These render the component directly instead.
describe('PriceChartSection', () => {
  it('draws a step path through every observation', () => {
    const html = renderToStaticMarkup(
      <PriceChartSection
        history={[
          at('2026-06-01T10:00:00Z', 975),
          at('2026-07-01T10:00:00Z', 487),
          at('2026-08-01T10:00:00Z', 731),
        ]}
      />,
    )

    const path = /d="([^"]+)"/.exec(html)?.[1]
    expect(path).toBeDefined()
    // One move, then two horizontal-plus-vertical pairs: a step, never a diagonal.
    expect(path?.startsWith('M ')).toBe(true)
    expect(path?.match(/L /g)).toHaveLength(4)

    // The cheapest observation sits at the bottom of the box and the dearest at the top.
    const ys = [...(path?.matchAll(/[ML] [\d.]+ ([\d.]+)/g) ?? [])].map((m) => Number(m[1]))
    expect(Math.min(...ys)).toBeLessThan(Math.max(...ys))

    expect(html).toContain('Low €4.87')
    expect(html).toContain('high €9.75')
  })

  it('says so plainly when there is nothing to plot', () => {
    const html = renderToStaticMarkup(<PriceChartSection history={[at('2026-06-01T10:00:00Z', 975)]} />)
    expect(html).toContain('No price changes recorded yet')
    expect(html).not.toContain('<svg')
  })
})
