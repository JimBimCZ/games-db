import Link from 'next/link'
import { Suspense } from 'react'
import { SearchInput } from '@/components/search-input'
import { ThemeToggle } from '@/components/theme-toggle'
import { signOutAction } from '@/server/auth/actions'
import { auth } from '@/server/auth/config'

export async function Toolbar() {
  const session = await auth()

  return (
    <header className="flex h-11 items-center gap-3 border-b border-line bg-bg-chrome px-3">
      <span className="font-semibold tracking-tight">Games</span>
      <Suspense fallback={<div className="h-[26px] w-48" />}>
        <SearchInput />
      </Suspense>
      <div className="ml-auto flex items-center gap-3">
        <ThemeToggle />
        {session?.user ? (
          <>
            <span className="text-text-dim">{session.user.name ?? session.user.email}</span>
            <form action={signOutAction}>
              <button
                type="submit"
                className="rounded-md border border-line px-2 py-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
              >
                Sign out
              </button>
            </form>
          </>
        ) : (
          <Link
            href="/signin"
            className="rounded-md border border-line px-2 py-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
          >
            Sign in
          </Link>
        )}
      </div>
    </header>
  )
}
