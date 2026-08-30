import Link from 'next/link'
import { CardGrid } from '@/components/card-grid'
import { FeaturedHero } from '@/components/featured-hero'
import { listCards, type ListKind } from '@/server/browse/queries'

const SECTIONS: { kind: ListKind; title: string; href: string }[] = [
  { kind: 'top_sellers', title: 'Top Sellers', href: '/top-sellers' },
  { kind: 'specials', title: 'Specials', href: '/specials' },
  { kind: 'coming_soon', title: 'Coming Soon', href: '/coming-soon' },
  { kind: 'new_releases', title: 'New Releases', href: '/new-releases' },
]

export default async function DiscoverPage() {
  const sections = await Promise.all(
    SECTIONS.map(async (section) => ({ ...section, games: await listCards(section.kind, 12) })),
  )
  const featured = sections[0]?.games[0]

  return (
    <div className="p-6">
      {featured ? <FeaturedHero game={featured} /> : null}
      {sections.map((section) => (
        <section key={section.kind} className="mb-8">
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="text-base font-semibold tracking-tight">{section.title}</h2>
            <Link
              href={section.href}
              className="text-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
            >
              See all
            </Link>
          </div>
          <CardGrid games={section.games} />
        </section>
      ))}
    </div>
  )
}
