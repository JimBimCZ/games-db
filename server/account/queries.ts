import 'server-only'
import { count, eq } from 'drizzle-orm'
import { connection } from 'next/server'
import { getDb } from '../../db/client.ts'
import { libraryEntry, users } from '../../db/schema.ts'
import { describeAccount, type AccountSummary } from '../../lib/account/summary.ts'
import { currentUserId } from '../auth/current-user.ts'

export async function accountSummary(): Promise<AccountSummary | null> {
  const userId = await currentUserId()
  if (!userId) return null

  await connection()
  const db = getDb()

  const [user] = await db
    .select({ name: users.name, email: users.email })
    .from(users)
    .where(eq(users.id, userId))

  if (!user) return null

  const [entries] = await db
    .select({ total: count() })
    .from(libraryEntry)
    .where(eq(libraryEntry.userId, userId))

  return describeAccount(user, entries?.total ?? 0)
}
