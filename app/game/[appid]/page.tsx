import Image from 'next/image'
import { notFound } from 'next/navigation'
import { ContentNotesSection } from '@/components/detail/content-notes'
import { DlcSection } from '@/components/detail/dlc-list'
import { LanguageSection } from '@/components/detail/language-table'
import { PriceChartSection } from '@/components/detail/price-chart'
import { RequirementsSection } from '@/components/detail/requirements'
import { StatusControl } from '@/components/library/status-control'
import { MediaViewer } from '@/components/media-viewer'
import { PriceCard } from '@/components/price-card'
import { ReviewBar } from '@/components/review-bar'
import { priceDelta } from '@/lib/format/price-delta'
import { statusSince } from '@/lib/format/status-history'
import { currentUserId } from '@/server/auth/current-user'
import { parseAppid } from '@/server/browse/params'
import { getReviewSummary } from '@/server/catalogue/review-summary'
import { gameDetailFull } from '@/server/detail/queries'
import { libraryEntryFor } from '@/server/library/queries'

type Platforms = { windows?: boolean; mac?: boolean; linux?: boolean }

function platformNames(platforms: unknown): string[] {
  if (typeof platforms !== 'object' || platforms === null) return []
  const p = platforms as Platforms
  return [
    p.windows ? 'Windows' : null,
    p.mac ? 'macOS' : null,
    p.linux ? 'Linux' : null,
  ].filter((name): name is string => name !== null)
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[10px] font-semibold uppercase tracking-wide text-text-dim">{label}</dt>
      <dd className="mt-0.5">{children}</dd>
    </div>
  )
}

export default async function GamePage({ params }: { params: Promise<{ appid: string }> }) {
  const { appid } = await params
  const parsedAppid = parseAppid(appid)
  if (parsedAppid === null) notFound()

  const detail = await gameDetailFull(parsedAppid)
  if (!detail) notFound()

  // Read-through cache: serves the stored summary inside its TTL and otherwise makes the one
  // live Steam call CLAUDE.md permits, for a game the user explicitly opened. It swallows and
  // logs its own failures, so a Steam outage costs the block, not the page.
  const reviews = await getReviewSummary(parsedAppid)

  const entry = await libraryEntryFor(parsedAppid)
  const since = entry ? statusSince(entry.status, entry.statusSince) : null
  const delta =
    entry && entry.status === 'wishlist'
      ? priceDelta(
          entry.priceSeenMinor,
          entry.priceSeenCurrency,
          detail.price?.finalMinor ?? null,
          detail.price?.currency ?? null,
        )
      : null
  const sessionUserPresent = (await currentUserId()) !== null

  const platforms = platformNames(detail.platforms)
  const developers = detail.developers ?? []
  const publishers = detail.publishers ?? []

  return (
    <article>
      <header className="relative border-b border-line">
        {detail.backgroundRaw ? (
          <Image
            src={detail.backgroundRaw}
            alt=""
            width={1438}
            height={810}
            loading="eager"
            fetchPriority="high"
            className="h-48 w-full object-cover"
          />
        ) : (
          <div className="h-48 w-full bg-bg-panel" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-bg to-transparent" />
        <div className="absolute inset-x-0 bottom-0 p-6">
          <h1 className="text-2xl font-semibold tracking-tight">{detail.name}</h1>
          {detail.releaseDateText ? (
            <p className="mt-0.5 text-text-dim">{detail.releaseDateText}</p>
          ) : null}
        </div>
      </header>

      <div className="grid gap-6 p-6 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="min-w-0">
          <MediaViewer media={detail.media} title={detail.name} />

          {detail.aboutHtml ? (
            <section className="mt-6">
              <h2 className="text-[10px] font-semibold uppercase tracking-wide text-text-dim">
                About this game
              </h2>
              {/* about_html was sanitised by the hydration job before it was cached
                  (map-app-details.ts), which is what makes this safe. The requirements
                  fields in the same row were deliberately not, and must be sanitised at
                  render time when M5's second PR adds them. */}
              <div
                className="steam-html mt-2 max-w-2xl"
                dangerouslySetInnerHTML={{ __html: detail.aboutHtml }}
              />
            </section>
          ) : null}

          <RequirementsSection
            platforms={[
              { label: 'Windows', raw: detail.pcRequirements },
              { label: 'macOS', raw: detail.macRequirements },
              { label: 'Linux', raw: detail.linuxRequirements },
            ]}
          />
          <DlcSection dlc={detail.dlc} />
          <LanguageSection raw={detail.supportedLanguagesRaw} />
          <ContentNotesSection notes={detail.contentDescriptorNotes} />
          <PriceChartSection history={detail.priceHistory} />
        </div>

        <aside className="flex flex-col gap-4 lg:sticky lg:top-6 lg:self-start">
          <PriceCard
            appid={detail.appid}
            isFree={detail.isFree}
            price={detail.price}
            releaseDateText={detail.releaseDateText}
            releaseComingSoon={detail.releaseComingSoon}
          />

          {sessionUserPresent ? (
            <div>
              <StatusControl appid={detail.appid} title={detail.name} status={entry?.status ?? null} />
              {since ? <p className="mt-1.5 text-text-dim">{since}</p> : null}
              {delta ? (
                <p className="mt-0.5 text-text-dim">
                  {delta.direction === 'down' ? '↓' : '↑'} {delta.label} since you wishlisted it
                </p>
              ) : null}
            </div>
          ) : null}

          <ReviewBar summary={reviews} />

          <dl className="flex flex-col gap-3">
            {developers.length > 0 ? (
              <Fact label="Developer">{developers.join(', ')}</Fact>
            ) : null}
            {publishers.length > 0 ? (
              <Fact label="Publisher">{publishers.join(', ')}</Fact>
            ) : null}
            {platforms.length > 0 ? <Fact label="Platforms">{platforms.join(', ')}</Fact> : null}
            {detail.genres.length > 0 ? <Fact label="Genres">{detail.genres.join(', ')}</Fact> : null}
            {detail.metacriticScore !== null ? (
              <Fact label="Metacritic">
                {detail.metacriticUrl ? (
                  <a
                    className="text-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
                    href={detail.metacriticUrl}
                    rel="noreferrer"
                    target="_blank"
                  >
                    {detail.metacriticScore}
                  </a>
                ) : (
                  detail.metacriticScore
                )}
              </Fact>
            ) : null}
            {detail.recommendationsTotal !== null ? (
              <Fact label="Recommendations">
                {detail.recommendationsTotal.toLocaleString('en')}
              </Fact>
            ) : null}
            {detail.achievementsTotal !== null ? (
              <Fact label="Achievements">{detail.achievementsTotal}</Fact>
            ) : null}
            {detail.categories.length > 0 ? (
              <Fact label="Features">{detail.categories.join(', ')}</Fact>
            ) : null}
          </dl>
        </aside>
      </div>
    </article>
  )
}
