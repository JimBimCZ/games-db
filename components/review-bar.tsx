import { summariseReviews, type ReviewCounts } from '@/lib/format/reviews'

export function ReviewBar({ summary }: { summary: ReviewCounts | undefined }) {
  const view = summary ? summariseReviews(summary) : null
  if (!view) return null

  return (
    <div>
      <div className="text-[10px] font-semibold uppercase tracking-wide text-text-dim">
        Reviews
      </div>
      <div className="mt-1 font-medium">{view.label ?? `${view.positivePercent}% positive`}</div>
      <div
        className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-line"
        role="img"
        aria-label={`${view.positivePercent}% of reviews are positive`}
      >
        <div className="h-full bg-positive" style={{ width: `${view.positivePercent}%` }} />
      </div>
      <div className="mt-1 text-text-dim">{view.countLine}</div>
    </div>
  )
}
