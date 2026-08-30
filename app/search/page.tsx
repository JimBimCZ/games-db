import { CardGrid } from '@/components/card-grid'
import { SEARCH_MIN, parseSearchQuery } from '@/server/browse/params'
import { searchCards } from '@/server/browse/queries'

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const raw = (await searchParams).q
  const q = parseSearchQuery(Array.isArray(raw) ? raw[0] : raw)

  if (!q) {
    return (
      <div className="p-6">
        <h1 className="mb-4 text-xl font-semibold tracking-tight">Search</h1>
        <p className="text-text-dim">Type at least {SEARCH_MIN} characters to search.</p>
      </div>
    )
  }

  const games = await searchCards(q)

  return (
    <div className="p-6">
      <h1 className="mb-4 text-xl font-semibold tracking-tight">
        Results for &ldquo;{q}&rdquo;
      </h1>
      <CardGrid games={games} empty="No games match that search yet." />
    </div>
  )
}
