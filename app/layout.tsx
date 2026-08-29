import type { Metadata } from 'next'
import { AppShell } from '@/components/app-shell'
import './globals.css'

export const metadata: Metadata = {
  title: 'Games',
  description: 'A personal PC games catalogue built on Steam store data.',
}

// Runs before first paint so an explicit choice never flashes the system theme first.
const themeScript = `
try {
  var t = localStorage.getItem('theme')
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t
} catch {}
`

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full antialiased">
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-full font-sans text-[13px]">
        <AppShell>{children}</AppShell>
      </body>
    </html>
  )
}
