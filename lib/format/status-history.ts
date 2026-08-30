import type { LibraryStatus } from '../library/statuses.ts'

// "Playing since March" reads right where "Playing in March" does not, so the preposition
// belongs to the status rather than the sentence.
const PHRASES: Record<LibraryStatus, string> = {
  backlog: 'In the backlog since',
  playing: 'Playing since',
  finished: 'Finished in',
  abandoned: 'Abandoned in',
  wishlist: 'Wishlisted in',
}

export function statusSince(status: LibraryStatus, at: Date | null): string | null {
  if (!at) return null
  const when = new Intl.DateTimeFormat('en', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(at)
  return `${PHRASES[status]} ${when}`
}
