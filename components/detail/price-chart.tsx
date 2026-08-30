import { formatMinor } from '@/lib/format/price'
import { buildPriceSeries, type PriceObservation } from '@/lib/format/price-series'
import { Section } from './section'

const WIDTH = 320
const HEIGHT = 64
const PAD = 4

const day = new Intl.DateTimeFormat('en', { day: 'numeric', month: 'short', year: 'numeric' })

export function PriceChartSection({ history }: { history: PriceObservation[] }) {
  const series = buildPriceSeries(history)

  if (!series) {
    return (
      <Section title="Price history">
        <p className="text-text-dim">
          No price changes recorded yet. History builds up as prices are refreshed.
        </p>
      </Section>
    )
  }

  const { points, minMinor, maxMinor, currency } = series
  const span = maxMinor - minMinor
  const stepX = (WIDTH - PAD * 2) / (points.length - 1)
  const y = (minor: number) =>
    span === 0 ? HEIGHT / 2 : PAD + ((maxMinor - minor) / span) * (HEIGHT - PAD * 2)

  // A step, not a slope: the price held at each value until the next observation, and a
  // diagonal would draw prices that were never charged.
  const path = points
    .map((point, index) => {
      const x = PAD + index * stepX
      if (index === 0) return `M ${x} ${y(point.finalMinor)}`
      const previous = points[index - 1]
      return `L ${x} ${y(previous?.finalMinor ?? point.finalMinor)} L ${x} ${y(point.finalMinor)}`
    })
    .join(' ')

  const first = points[0]
  const last = points[points.length - 1]

  return (
    <Section title="Price history">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="w-full max-w-md"
        role="img"
        aria-label={`${points.length} price observations between ${formatMinor(minMinor, currency)} and ${formatMinor(maxMinor, currency)}`}
      >
        <path d={path} fill="none" stroke="var(--accent)" strokeWidth="1.5" />
      </svg>
      <div className="mt-1 flex max-w-md justify-between text-text-dim">
        <span>{first ? day.format(first.observedAt) : null}</span>
        <span>
          Low {formatMinor(minMinor, currency)} · high {formatMinor(maxMinor, currency)}
        </span>
        <span>{last ? day.format(last.observedAt) : null}</span>
      </div>
    </Section>
  )
}
