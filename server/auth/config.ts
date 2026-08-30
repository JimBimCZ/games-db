import 'server-only'
import { DrizzleAdapter } from '@auth/drizzle-adapter'
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core'
import NextAuth from 'next-auth'
import GitHub from 'next-auth/providers/github'
import { getDb } from '@/db/client.ts'
import { accounts, sessions, users } from '@/db/schema.ts'
import { projectSession } from './session.ts'

// next build evaluates route modules while collecting page data, so building the adapter at
// module scope would construct a database client during a build that has no DATABASE_URL.
export const { handlers, auth, signIn, signOut } = NextAuth(() => ({
  adapter: DrizzleAdapter(
    // Db omits `transaction` because neon-http cannot offer one; the adapter's parameter type
    // requires it but its Postgres implementation never calls it.
    getDb() as unknown as PgDatabase<PgQueryResultHKT, Record<string, never>>,
    { usersTable: users, accountsTable: accounts, sessionsTable: sessions },
  ),
  session: { strategy: 'database' },
  providers: [GitHub],
  pages: { signIn: '/signin' },
  callbacks: {
    session({ session, user }) {
      return projectSession(user, session.expires)
    },
  },
}))
