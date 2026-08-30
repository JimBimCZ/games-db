import { CardGrid } from '@/components/card-grid'
import { listCards } from '@/server/browse/queries'

export default async function NewReleasesPage() {
  const games = await listCards('new_releases', 100)
  return (
    <div className="p-6">
      <h1 className="mb-4 text-xl font-semibold tracking-tight">New Releases</h1>
      <CardGrid games={games} />
    </div>
  )
}
