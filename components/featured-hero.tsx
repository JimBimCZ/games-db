import Image from 'next/image'
import Link from 'next/link'
import { formatMinor } from '@/lib/format/price'
import type { GameCard as GameCardData } from '@/server/browse/queries'

export function FeaturedHero({ game }: { game: GameCardData }) {
  return (
    <Link
      href={`/game/${game.appid}`}
      className="group mb-8 flex gap-5 rounded-lg border border-line bg-bg-panel p-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
    >
      {game.headerImage ? (
        <Image
          src={game.headerImage}
          alt={game.name}
          width={460}
          height={215}
          priority
          className="w-[340px] shrink-0 rounded-md border border-line object-cover"
        />
      ) : null}
      <div className="min-w-0">
        <div className="text-[10px] font-semibold uppercase tracking-wide text-text-dim">
          Featured
        </div>
        <h2 className="mt-1 text-lg font-semibold tracking-tight group-hover:text-accent">
          {game.name}
        </h2>
        {game.shortDescription ? (
          <p className="mt-2 line-clamp-3 text-text-dim">{game.shortDescription}</p>
        ) : null}
        {game.isFree ? (
          <div className="mt-3 text-text-dim">Free</div>
        ) : game.price ? (
          <div className="mt-3 flex items-center gap-1.5">
            {game.price.discountPercent > 0 ? (
              <>
                <span className="rounded bg-positive px-1 text-[11px] font-semibold text-white">
                  −{game.price.discountPercent}%
                </span>
                <span className="text-text-dim line-through">
                  {formatMinor(game.price.initialMinor, game.price.currency)}
                </span>
              </>
            ) : null}
            <span className="font-medium">
              {formatMinor(game.price.finalMinor, game.price.currency)}
            </span>
          </div>
        ) : null}
      </div>
    </Link>
  )
}
