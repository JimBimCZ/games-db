import 'server-only'
import { cache } from 'react'
import { auth } from './config.ts'
import { userIdFromSession } from './session.ts'

// Separate from session.ts because config.ts imports that file; importing auth back into it
// would close the cycle.
// Cached per request: several library surfaces call this multiple times per render (e.g. a
// detail page calling it directly, then again inside libraryEntryFor), and with the database
// session strategy each call is otherwise a real session lookup.
export const currentUserId = cache(async (): Promise<string | null> => {
  return userIdFromSession(await auth())
})
