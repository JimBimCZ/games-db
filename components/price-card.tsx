import { formatMinor } from '@/lib/format/price'

type Price = {
  currency: string
  initialMinor: number
  finalMinor: number
  discountPercent: number
}

export function PriceCard({
  appid,
  isFree,
  price,
  releaseDateText,
  releaseComingSoon,
}: {
  appid: number
  isFree: boolean
  price: Price | null
  releaseDateText: string | null
  releaseComingSoon: boolean
}) {
  return (
    <div className="rounded-lg border border-line bg-bg-panel p-3">
      {isFree ? (
        <div className="text-lg font-semibold">Free</div>
      ) : price ? (
        <div className="flex flex-wrap items-baseline gap-2">
          {price.discountPercent > 0 ? (
            <>
              <span className="rounded bg-positive px-1 py-0.5 text-[11px] font-semibold text-white">
                −{price.discountPercent}%
              </span>
              <span className="text-text-dim line-through">
                {formatMinor(price.initialMinor, price.currency)}
              </span>
            </>
          ) : null}
          <span className="text-lg font-semibold">
            {formatMinor(price.finalMinor, price.currency)}
          </span>
        </div>
      ) : (
        // 232 of 552 hydrated games are not free and carry no price row. Naming the state
        // beats an empty box that reads as a loading failure.
        <div className="text-text-dim">
          {releaseComingSoon && releaseDateText ? releaseDateText : 'Price unavailable'}
        </div>
      )}

      <a
        className="mt-3 block rounded-md border border-line bg-bg px-3 py-1.5 text-center font-medium hover:border-accent hover:text-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
        href={`https://store.steampowered.com/app/${appid}`}
        rel="noreferrer"
        target="_blank"
      >
        View on Steam
      </a>
    </div>
  )
}
