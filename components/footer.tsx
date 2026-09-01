import Link from 'next/link'

const linkClass =
  'rounded-sm hover:text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent'

export function Footer() {
  return (
    <footer className="mt-8 border-t border-line bg-bg-chrome px-3 py-3 text-text-dim">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <Link className={linkClass} href="/privacy">
          Privacy
        </Link>
        <a
          className={linkClass}
          href="https://github.com/JimBimCZ/games-db"
          rel="noreferrer"
          target="_blank"
        >
          Source
        </a>
        <span className="ml-auto">
          Game data and artwork from Steam. Not affiliated with Valve Corporation.
        </span>
      </div>
    </footer>
  )
}
