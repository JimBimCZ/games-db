import type { LibraryStatus } from '../../lib/library/statuses.ts'

export type CurrentPrice = { finalMinor: number; currency: string } | null

export type TransitionPlan =
  | { kind: 'noop' }
  | {
      kind: 'write'
      status: LibraryStatus
      priceSeen: { minor: number; currency: string } | null
    }

export function planTransition(
  existingStatus: LibraryStatus | null,
  requested: LibraryStatus,
  price: CurrentPrice,
): TransitionPlan {
  if (existingStatus === requested) return { kind: 'noop' }

  return {
    kind: 'write',
    status: requested,
    priceSeen:
      requested === 'wishlist' && price
        ? { minor: price.finalMinor, currency: price.currency }
        : null,
  }
}
