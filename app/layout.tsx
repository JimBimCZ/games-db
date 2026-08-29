import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Games',
  description: 'A personal PC games catalogue built on Steam store data.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full font-sans text-[13px]">{children}</body>
    </html>
  )
}
