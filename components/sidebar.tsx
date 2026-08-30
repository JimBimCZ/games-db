import Link from 'next/link'
import { sidebarGenres } from '@/server/browse/queries'

const sections = [
  {
    id: 'sidebar-library',
    label: 'Library',
    items: [
      { href: '/library', name: 'All Games' },
      { href: '/library?status=playing', name: 'Playing' },
      { href: '/library?status=backlog', name: 'Backlog' },
      { href: '/library?status=finished', name: 'Finished' },
      { href: '/library?status=abandoned', name: 'Abandoned' },
      { href: '/library?status=wishlist', name: 'Wishlist' },
    ],
  },
  {
    id: 'sidebar-store',
    label: 'Store',
    items: [
      { href: '/', name: 'Discover' },
      { href: '/top-sellers', name: 'Top Sellers' },
      { href: '/specials', name: 'Specials' },
      { href: '/coming-soon', name: 'Coming Soon' },
      { href: '/new-releases', name: 'New Releases' },
    ],
  },
]

const itemClass =
  'block rounded-md px-2 py-1 hover:bg-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent'

const headingClass =
  'px-2 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-text-dim'

export async function Sidebar() {
  const genres = await sidebarGenres()

  return (
    <nav
      aria-label="Sections"
      className="w-[200px] shrink-0 border-r border-line bg-bg-sidebar p-2"
    >
      {sections.map((section) => (
        <div key={section.label} className="mb-3">
          <h2 id={section.id} className={headingClass}>
            {section.label}
          </h2>
          <ul aria-labelledby={section.id}>
            {section.items.map((item) => (
              <li key={item.href}>
                <Link href={item.href} className={itemClass}>
                  {item.name}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ))}
      {genres.length > 0 ? (
        <div className="mb-3">
          <h2 id="sidebar-genres" className={headingClass}>
            Genres
          </h2>
          <ul aria-labelledby="sidebar-genres">
            {genres.map((genre) => (
              <li key={genre.id}>
                <Link href={`/genre/${genre.id}`} className={itemClass}>
                  {genre.description}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </nav>
  )
}
