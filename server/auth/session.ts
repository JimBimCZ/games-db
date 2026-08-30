import type { Session } from 'next-auth'

type AdapterUserLike = {
  id: string
  name?: string | null
  email: string | null
  image?: string | null
  emailVerified: Date | null
}

export function projectSession(
  user: AdapterUserLike,
  expires: Session['expires'] | Date,
): Session {
  return {
    user: { id: user.id, name: user.name, email: user.email, image: user.image },
    expires,
  } as Session
}

export function userIdFromSession(session: Session | null): string | null {
  return session?.user?.id ?? null
}
