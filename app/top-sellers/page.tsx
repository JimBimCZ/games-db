import { CardGrid } from '@/components/card-grid'
import { listCards } from '@/server/browse/queries'

export default async function TopSellersPage() {
  const games = await listCards('top_sellers', 100)
  return (
    <div className="p-6">
      <h1 className="mb-4 text-xl font-semibold tracking-tight">Top Sellers</h1>
      <CardGrid games={games} />
    </div>
  )
}
