export type ReviewCounts = {
  reviewScore: number | undefined
  reviewScoreDesc: string | undefined
  totalPositive: number
  totalNegative: number
  totalReviews: number
}

export type ReviewView = {
  label: string | null
  positivePercent: number
  countLine: string
}

const counts = new Intl.NumberFormat('en')

export function summariseReviews(summary: ReviewCounts): ReviewView | null {
  const rated = summary.totalPositive + summary.totalNegative
  if (rated === 0) return null

  return {
    label: summary.reviewScoreDesc ?? null,
    positivePercent: Math.round((summary.totalPositive / rated) * 100),
    countLine: `${counts.format(summary.totalPositive)} of ${counts.format(summary.totalReviews)}`,
  }
}
