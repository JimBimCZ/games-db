import Link from 'next/link'
import { redirect } from 'next/navigation'
import { DeleteAccount } from '@/components/account/delete-account'
import { entryCountLabel } from '@/lib/account/summary'
import { accountSummary } from '@/server/account/queries'

const termClass = 'text-text-dim'

export default async function AccountPage() {
  const summary = await accountSummary()
  if (!summary) redirect('/signin')

  return (
    <div className="p-6">
      <h1 className="mb-4 text-xl font-semibold tracking-tight">Account</h1>

      <div className="max-w-xl rounded-xl border border-line bg-bg-panel p-4">
        <h2 className="mb-3 font-semibold">{summary.displayName}</h2>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
          <dt className={termClass}>Signed in with</dt>
          <dd>GitHub</dd>
          <dt className={termClass}>Email</dt>
          <dd>{summary.email ?? 'None supplied by GitHub'}</dd>
          <dt className={termClass}>Library</dt>
          <dd>{entryCountLabel(summary.entryCount)}</dd>
        </dl>
        <p className="mt-3 text-text-dim">
          <Link className="text-accent" href="/privacy">
            The privacy policy
          </Link>{' '}
          lists everything this app stores about you and why.
        </p>
      </div>

      <div className="mt-4 max-w-xl rounded-xl border border-line p-4">
        <h2 className="mb-1 font-semibold">Delete this account</h2>
        <p className="mb-3 text-text-dim">
          Removes your profile, your GitHub connection, every sign-in session and everything
          in your library, including its status history. It happens immediately and there is
          no backup to restore from. Nothing about the games catalogue itself is affected, and
          you can sign in again afterwards to start over.
        </p>
        <DeleteAccount entryCount={summary.entryCount} />
      </div>
    </div>
  )
}
