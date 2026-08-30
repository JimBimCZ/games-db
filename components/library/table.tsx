import Image from 'next/image'
import Link from 'next/link'
import { StatusControl } from '@/components/library/status-control'
import { formatMinor } from '@/lib/format/price'
import { priceDelta } from '@/lib/format/price-delta'
import { STATUS_LABELS, type LibraryStatus } from '@/lib/library/statuses'
import type { SortDir, SortKey } from '@/server/library/params'
import type { LibraryRow } from '@/server/library/queries'

const COLUMNS: { key: SortKey; label: string }[] = [
  { key: 'name', label: 'Game' },
  { key: 'status', label: 'Status' },
  { key: 'added', label: 'Added' },
  { key: 'price', label: 'Price' },
]

const dateFormat = new Intl.DateTimeFormat('en', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
})

function SortHeader({
  column,
  sort,
  dir,
  status,
}: {
  column: { key: SortKey; label: string }
  sort: SortKey
  dir: SortDir
  status: LibraryStatus | null
}) {
  const active = sort === column.key
  const params = new URLSearchParams()
  if (status) params.set('status', status)
  params.set('sort', column.key)
  params.set('dir', active && dir === 'desc' ? 'asc' : 'desc')

  return (
    <th
      aria-sort={active ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}
      className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wide text-text-dim"
      scope="col"
    >
      <Link
        className="hover:text-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
        href={`/library?${params.toString()}`}
      >
        {column.label}
        {active ? (dir === 'asc' ? ' ▲' : ' ▼') : null}
      </Link>
    </th>
  )
}

function PriceCell({ row }: { row: LibraryRow }) {
  if (row.isFree) {
    return <span className="text-text-dim">Free</span>
  }

  if (row.finalMinor === null || row.currency === null) {
    return <span className="text-text-dim">Price unavailable</span>
  }

  const delta =
    row.status === 'wishlist'
      ? priceDelta(row.priceSeenMinor, row.priceSeenCurrency, row.finalMinor, row.currency)
      : null

  return (
    <>
      <div className="flex items-center gap-1.5">
        {row.discountPercent !== null && row.discountPercent > 0 && row.initialMinor !== null ? (
          <>
            <span className="rounded bg-positive px-1 text-[11px] font-semibold text-white">
              −{row.discountPercent}%
            </span>
            <span className="text-text-dim line-through">
              {formatMinor(row.initialMinor, row.currency)}
            </span>
          </>
        ) : null}
        <span className="font-medium">{formatMinor(row.finalMinor, row.currency)}</span>
      </div>
      {delta ? (
        <div className="text-[11px] text-text-dim">
          {delta.direction === 'down' ? '↓' : '↑'} {delta.label} since added
        </div>
      ) : null}
    </>
  )
}

export function LibraryTable({
  rows,
  sort,
  dir,
  status,
}: {
  rows: LibraryRow[]
  sort: SortKey
  dir: SortDir
  status: LibraryStatus | null
}) {
  return (
    <table className="w-full border-collapse">
      <caption className="sr-only">
        Your library{status ? `, filtered to ${STATUS_LABELS[status]}` : ''}
      </caption>
      <thead>
        <tr className="border-b border-line">
          {COLUMNS.map((column) => (
            <SortHeader column={column} dir={dir} key={column.key} sort={sort} status={status} />
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr className="border-b border-line align-middle" key={row.appid}>
            <td className="px-3 py-2">
              <Link
                className="flex items-center gap-2 hover:text-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
                href={`/game/${row.appid}`}
              >
                {row.capsuleImage ? (
                  <Image
                    alt=""
                    className="h-[32px] w-[68px] rounded border border-line object-cover"
                    height={32}
                    loading="lazy"
                    src={row.capsuleImage}
                    width={68}
                  />
                ) : (
                  <span className="h-[32px] w-[68px] rounded border border-line bg-bg-panel" />
                )}
                {/* An entry can outlive its game row: there is no foreign key on appid. */}
                <span className="truncate">{row.name ?? `Unknown game (${row.appid})`}</span>
              </Link>
            </td>
            <td className="px-3 py-2">
              <StatusControl
                appid={row.appid}
                status={row.status}
                title={row.name ?? String(row.appid)}
                variant="compact"
              />
            </td>
            <td className="px-3 py-2 text-text-dim">{dateFormat.format(row.addedAt)}</td>
            <td className="px-3 py-2">
              <PriceCell row={row} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
