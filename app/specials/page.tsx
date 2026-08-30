import { CardGrid } from '@/components/card-grid'
import { listCards } from '@/server/browse/queries'

export default async function SpecialsPage() {
  const games = await listCards('specials', 100)
  return (
    <div className="p-6">
      <h1 className="mb-4 text-xl font-semibold tracking-tight">Specials</h1>
      <CardGrid games={games} empty="No discounted games have been filled in yet." />
    </div>
  )
}
