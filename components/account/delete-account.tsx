'use client'
import { useEffect, useRef, useState, useTransition } from 'react'
import { entryCountLabel } from '@/lib/account/summary'
import { deleteAccountAction } from '@/server/account/actions'

const buttonClass =
  'rounded-md px-3 py-1.5 font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent'

export function DeleteAccount({ entryCount }: { entryCount: number }) {
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const cancelRef = useRef<HTMLButtonElement>(null)

  // Focus lands on Cancel rather than Confirm: the destructive button should never be one
  // stray Enter away from firing.
  useEffect(() => {
    if (confirming) cancelRef.current?.focus()
  }, [confirming])

  function handleDelete() {
    startTransition(async () => {
      setError(null)
      const result = await deleteAccountAction()
      if (result && !result.ok) setError(result.error)
    })
  }

  return (
    <div>
      {confirming ? (
        <div>
          <p className="mb-3 font-medium" id="delete-account-warning">
            {entryCount > 0
              ? `Delete your account, your GitHub connection and ${entryCountLabel(
                  entryCount,
                ).toLowerCase()}?`
              : 'Delete your account and your GitHub connection?'}{' '}
            This cannot be undone.
          </p>
          <div className="flex gap-2">
            <button
              className={`${buttonClass} border border-line`}
              disabled={pending}
              onClick={() => setConfirming(false)}
              ref={cancelRef}
              type="button"
            >
              Cancel
            </button>
            <button
              aria-describedby="delete-account-warning"
              className={`${buttonClass} bg-danger text-white disabled:opacity-60`}
              disabled={pending}
              onClick={handleDelete}
              type="button"
            >
              {pending ? 'Deleting…' : 'Yes, delete my account'}
            </button>
          </div>
        </div>
      ) : (
        <button
          className={`${buttonClass} border border-line text-danger`}
          onClick={() => setConfirming(true)}
          type="button"
        >
          Delete my account
        </button>
      )}
      <p aria-live="polite" className="mt-2 text-text-dim">
        {error}
      </p>
    </div>
  )
}
