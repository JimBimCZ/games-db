import Image from 'next/image'
import { notFound } from 'next/navigation'
import { formatMinor } from '@/lib/format/price'
import { parseAppid } from '@/server/browse/params'
import { gameDetail } from '@/server/browse/queries'

export default async function GamePage({ params }: { params: Promise<{ appid: string }> }) {
  const { appid } = await params
  const parsedAppid = parseAppid(appid)
  if (parsedAppid === null) notFound()

  const detail = await gameDetail(parsedAppid)
  if (!detail) notFound()

  const { card, genres } = detail

  return (
    <article className="p-6">
      <h1 className="text-xl font-semibold tracking-tight">{card.name}</h1>
      {card.headerImage ? (
        <Image
          src={card.headerImage}
          alt={card.name}
          width={460}
          height={215}
          priority
          className="mt-3 rounded-md border border-line"
        />
      ) : null}
      <dl className="mt-4 grid max-w-md grid-cols-[8rem_1fr] gap-y-1">
        <dt className="text-text-dim">Release</dt>
        <dd>{card.releaseDateText ?? 'Unknown'}</dd>
        <dt className="text-text-dim">Genres</dt>
        <dd>{genres.length > 0 ? genres.join(', ') : '—'}</dd>
        <dt className="text-text-dim">Price</dt>
        <dd>
          {card.isFree
            ? 'Free'
            : card.price
              ? card.price.discountPercent > 0
                ? `${formatMinor(card.price.finalMinor, card.price.currency)} (was ${formatMinor(card.price.initialMinor, card.price.currency)}, −${card.price.discountPercent}%)`
                : formatMinor(card.price.finalMinor, card.price.currency)
              : 'Not listed'}
        </dd>
      </dl>
      <a
        className="mt-4 inline-block text-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
        href={`https://store.steampowered.com/app/${card.appid}`}
        rel="noreferrer"
        target="_blank"
      >
        View on Steam
      </a>
    </article>
  )
}
