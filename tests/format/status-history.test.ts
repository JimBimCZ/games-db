import { describe, expect, it } from 'vitest'
import { statusSince } from '@/lib/format/status-history'

describe('statusSince', () => {
  it('names the month and year the status was set', () => {
    expect(statusSince('finished', new Date('2026-03-14T10:00:00Z'))).toBe(
      'Finished in March 2026',
    )
  })

  it('uses each status label', () => {
    expect(statusSince('playing', new Date('2026-01-02T00:00:00Z'))).toBe('Playing since January 2026')
    expect(statusSince('wishlist', new Date('2026-01-02T00:00:00Z'))).toBe(
      'Wishlisted in January 2026',
    )
  })

  it('renders nothing without a recorded event', () => {
    expect(statusSince('finished', null)).toBeNull()
  })
})
