import 'server-only'
import { auth } from './config.ts'
import { userIdFromSession } from './session.ts'

// Separate from session.ts because config.ts imports that file; importing auth back into it
// would close the cycle.
export async function currentUserId(): Promise<string | null> {
  return userIdFromSession(await auth())
}
