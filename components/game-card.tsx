import Image from 'next/image'
import Link from 'next/link'
import { formatMinor } from '@/lib/format/price'
import type { GameCard as GameCardData } from '@/server/browse/queries'

function PriceLine({ game }: { game: GameCardData }) {
  if (game.isFree) return <div className="text-text-dim">Free</div>

  if (!game.price) {
    // 232 of 552 hydrated games are not free and have no price row. A dash here would read as "free".
    return game.releaseComingSoon && game.releaseDateText ? (
      <div className="text-text-dim">{game.releaseDateText}</div>
    ) : null
  }

  const { currency, initialMinor, finalMinor, discountPercent } = game.price
  if (discountPercent === 0) {
    return <div className="text-text-dim">{formatMinor(finalMinor, currency)}</div>
  }

  return (
    <div className="flex items-center gap-1.5">
      <span className="rounded bg-positive px-1 text-[11px] font-semibold text-white">
        −{discountPercent}%
      </span>
      <span className="text-text-dim line-through">{formatMinor(initialMinor, currency)}</span>
      <span className="font-medium">{formatMinor(finalMinor, currency)}</span>
    </div>
  )
}

export function GameCard({ game }: { game: GameCardData }) {
  return (
    <Link
      href={`/game/${game.appid}`}
      className="group block rounded-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
    >
      {game.headerImage ? (
        <Image
          src={game.headerImage}
          alt={game.name}
          width={460}
          height={215}
          loading="lazy"
          className="aspect-[460/215] w-full rounded-md border border-line object-cover"
        />
      ) : (
        <div className="aspect-[460/215] w-full rounded-md border border-line bg-bg-panel" />
      )}
      <div className="pt-1.5">
        <div className="truncate font-medium group-hover:text-accent">{game.name}</div>
        <PriceLine game={game} />
      </div>
    </Link>
  )
}
