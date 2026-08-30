'use client'
import { startTransition, useOptimistic, useState } from 'react'
import { LIBRARY_STATUSES, STATUS_LABELS, type LibraryStatus } from '@/lib/library/statuses'
import { removeFromLibrary, setLibraryStatus } from '@/server/library/actions'

const REMOVE = '__remove__'
const NONE = '__none__'

export function StatusControl({
  appid,
  title,
  status,
  variant = 'full',
}: {
  appid: number
  title: string
  status: LibraryStatus | null
  variant?: 'full' | 'compact'
}) {
  const [optimisticStatus, setOptimisticStatus] = useOptimistic(status)
  const [error, setError] = useState<string | null>(null)

  function handleChange(value: string) {
    startTransition(async () => {
      setError(null)
      const next = value === REMOVE || value === NONE ? null : (value as LibraryStatus)
      // Read from the optimistic value, not the prop: a second change before the first
      // settles would otherwise act on a stale closure.
      setOptimisticStatus(next)

      const result =
        next === null ? await removeFromLibrary(appid) : await setLibraryStatus(appid, next)

      // No revalidation happens on failure, so the prop is unchanged and the optimistic
      // value reverts on its own when this transition ends.
      if (!result.ok) setError(result.error)
    })
  }

  return (
    <div className={variant === 'compact' ? '' : 'w-full'}>
      <select
        aria-label={`Library status for ${title}`}
        className={
          variant === 'compact'
            ? 'rounded-md border border-line bg-bg-chrome/90 px-1.5 py-0.5 text-[11px] backdrop-blur focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent'
            : 'w-full rounded-md border border-line bg-bg px-3 py-1.5 font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent'
        }
        onChange={(event) => handleChange(event.target.value)}
        value={optimisticStatus ?? NONE}
      >
        {optimisticStatus ? null : (
          <option value={NONE}>{variant === 'compact' ? '+ Add' : 'Add to Library'}</option>
        )}
        {LIBRARY_STATUSES.map((value) => (
          <option key={value} value={value}>
            {STATUS_LABELS[value]}
          </option>
        ))}
        {optimisticStatus ? <option value={REMOVE}>Remove from library</option> : null}
      </select>
      <p aria-live="polite" className="mt-1 text-[11px] text-text-dim">
        {error}
      </p>
    </div>
  )
}
