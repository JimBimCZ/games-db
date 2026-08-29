import { Sidebar } from '@/components/sidebar'
import { Toolbar } from '@/components/toolbar'

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Toolbar />
        <main className="flex-1">{children}</main>
      </div>
    </div>
  )
}
