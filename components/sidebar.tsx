import Link from 'next/link'

const sections = [
  {
    label: 'Library',
    items: [
      { href: '/library', name: 'All Games' },
      { href: '/library?status=playing', name: 'Playing' },
      { href: '/library?status=backlog', name: 'Backlog' },
      { href: '/library?status=finished', name: 'Finished' },
      { href: '/library?status=wishlist', name: 'Wishlist' },
    ],
  },
  {
    label: 'Store',
    items: [
      { href: '/', name: 'Discover' },
      { href: '/specials', name: 'Specials' },
      { href: '/coming-soon', name: 'Coming Soon' },
      { href: '/new-releases', name: 'New Releases' },
    ],
  },
]

export function Sidebar() {
  return (
    <nav
      aria-label="Sections"
      className="w-[200px] shrink-0 border-r border-line bg-bg-sidebar p-2"
    >
      {sections.map((section) => (
        <div key={section.label} className="mb-3">
          <h2 className="px-2 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-text-dim">
            {section.label}
          </h2>
          <ul>
            {section.items.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className="block rounded-md px-2 py-1 hover:bg-black/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent dark:hover:bg-white/10"
                >
                  {item.name}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  )
}
