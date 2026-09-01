'use server'
import { eq } from 'drizzle-orm'
import { getDb } from '../../db/client.ts'
import { users } from '../../db/schema.ts'
import { signOut } from '../auth/config.ts'
import { currentUserId } from '../auth/current-user.ts'

export type DeleteAccountResult = { ok: false; error: string }

const SIGN_IN = 'Sign in to delete your account.'
const DELETE_FAILED = 'Could not delete your account. Try again.'

// Returns only on failure: the success path ends in signOut, which redirects by throwing.
export async function deleteAccountAction(): Promise<DeleteAccountResult | void> {
  const userId = await currentUserId()
  if (!userId) return { ok: false, error: SIGN_IN }

  try {
    // Deleting the one row is enough: accounts, sessions and library_entry all declare
    // onDelete: 'cascade' on their user reference, and library_status_event cascades from
    // library_entry in turn.
    await getDb().delete(users).where(eq(users.id, userId))
  } catch (error) {
    console.error('account deleteAccountAction failed:', error)
    return { ok: false, error: DELETE_FAILED }
  }

  // Outside the try, because signOut signals its redirect by throwing and catching it here
  // would strand the user on a page whose account no longer exists. The cascade already took
  // the session row; the adapter's deleteSession is an unconditional delete, so it no-ops.
  await signOut({ redirectTo: '/' })
}
