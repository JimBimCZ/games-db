export const LIBRARY_STATUSES = [
  'backlog',
  'playing',
  'finished',
  'abandoned',
  'wishlist',
] as const

export type LibraryStatus = (typeof LIBRARY_STATUSES)[number]

export const STATUS_LABELS: Record<LibraryStatus, string> = {
  backlog: 'Backlog',
  playing: 'Playing',
  finished: 'Finished',
  abandoned: 'Abandoned',
  wishlist: 'Wishlist',
}
