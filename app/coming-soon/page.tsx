import { CardGrid } from '@/components/card-grid'
import { listCards } from '@/server/browse/queries'

export default async function ComingSoonPage() {
  const games = await listCards('coming_soon', 100)
  return (
    <div className="p-6">
      <h1 className="mb-4 text-xl font-semibold tracking-tight">Coming Soon</h1>
      <CardGrid games={games} />
    </div>
  )
}
