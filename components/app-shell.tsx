import { Footer } from '@/components/footer'
import { Sidebar } from '@/components/sidebar'
import { Toolbar } from '@/components/toolbar'

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-50 focus:rounded-md focus:border focus:border-line focus:bg-bg-chrome focus:px-3 focus:py-2 focus:text-text focus:outline focus:outline-2 focus:outline-accent"
      >
        Skip to content
      </a>
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Toolbar />
        <main id="main" className="flex-1">
          {children}
        </main>
        <Footer />
      </div>
    </div>
  )
}
