import Link from 'next/link'
import { redirect } from 'next/navigation'
import { LibraryTable } from '@/components/library/table'
import { STATUS_LABELS } from '@/lib/library/statuses'
import { parseDir, parseSort, parseStatusFilter } from '@/server/library/params'
import { libraryRows } from '@/server/library/queries'

export default async function LibraryPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; sort?: string; dir?: string }>
}) {
  const params = await searchParams
  const status = parseStatusFilter(params.status)
  const sort = parseSort(params.sort)
  const dir = parseDir(params.dir)

  const rows = await libraryRows(status, sort, dir)
  if (rows === null) redirect('/signin')

  const heading = status ? STATUS_LABELS[status] : 'All Games'

  return (
    <div className="p-6">
      <h1 className="mb-4 text-base font-semibold tracking-tight">{heading}</h1>
      {rows.length > 0 ? (
        <LibraryTable dir={dir} rows={rows} sort={sort} status={status} />
      ) : status ? (
        <p className="py-8 text-text-dim">
          Nothing filed under {STATUS_LABELS[status]} yet.{' '}
          <Link className="text-accent" href="/library">
            See everything in your library
          </Link>
          .
        </p>
      ) : (
        <p className="py-8 text-text-dim">
          Your library is empty.{' '}
          <Link className="text-accent" href="/">
            Find something on Discover
          </Link>
          .
        </p>
      )}
    </div>
  )
}
