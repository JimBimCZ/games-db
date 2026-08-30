import { describe, expect, it } from 'vitest'
import { summariseReviews } from '@/lib/format/reviews'

const base = { reviewScore: 8, reviewScoreDesc: 'Very Positive' }

describe('summariseReviews', () => {
  it('reports the positive share and a grouped count line', () => {
    const view = summariseReviews({ ...base, totalPositive: 303463, totalNegative: 26488, totalReviews: 329951 })
    expect(view).not.toBeNull()
    expect(view?.label).toBe('Very Positive')
    expect(view?.positivePercent).toBe(92)
    expect(view?.countLine).toBe('303,463 of 329,951')
  })

  // A game with no reviews yet has no score to draw. Rendering a 0% bar would read as
  // universally panned rather than unrated.
  it('returns null when nothing has been reviewed', () => {
    expect(summariseReviews({ ...base, totalPositive: 0, totalNegative: 0, totalReviews: 0 })).toBeNull()
  })

  it('handles an all-negative game without dividing by zero', () => {
    const view = summariseReviews({ ...base, totalPositive: 0, totalNegative: 4, totalReviews: 4 })
    expect(view?.positivePercent).toBe(0)
    expect(view?.countLine).toBe('0 of 4')
  })

  it('survives a missing description', () => {
    const view = summariseReviews({
      reviewScore: undefined,
      reviewScoreDesc: undefined,
      totalPositive: 3,
      totalNegative: 1,
      totalReviews: 4,
    })
    expect(view?.label).toBeNull()
    expect(view?.positivePercent).toBe(75)
  })

  // Nothing guarantees total_reviews equals positive + negative, so the bar is drawn from
  // the two component counts and can never exceed 100%. The count line quotes Steam's own
  // total unchanged.
  it('draws the bar from the component counts, not the reported total', () => {
    const view = summariseReviews({ ...base, totalPositive: 90, totalNegative: 10, totalReviews: 250 })
    expect(view?.positivePercent).toBe(90)
    expect(view?.countLine).toBe('90 of 250')
  })
})
