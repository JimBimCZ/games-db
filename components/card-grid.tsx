import { GameCard } from '@/components/game-card'
import type { GameCard as GameCardData } from '@/server/browse/queries'
import { libraryStatusMap } from '@/server/library/queries'

export async function CardGrid({ games, empty }: { games: GameCardData[]; empty?: string }) {
  if (games.length === 0) {
    return (
      <p className="py-8 text-text-dim">
        {empty ?? 'Nothing here yet — the catalogue is still being filled in.'}
      </p>
    )
  }

  // Resolved here rather than in each of the seven browse pages; cache() collapses the
  // repeat calls when a page renders several grids.
  const statuses = await libraryStatusMap()

  return (
    <ul className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-4">
      {games.map((game) => (
        <li key={game.appid}>
          <GameCard
            game={game}
            status={statuses === null ? undefined : (statuses.get(game.appid) ?? null)}
          />
        </li>
      ))}
    </ul>
  )
}
