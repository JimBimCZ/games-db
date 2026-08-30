import { describe, expect, it } from 'vitest'
import type { Session } from 'next-auth'
import { projectSession, userIdFromSession } from '@/server/auth/session'

describe('projectSession', () => {
  const expires = new Date('2026-09-30T00:00:00Z')

  it('exposes only the fields the UI needs', () => {
    const record = {
      id: 'u1',
      name: 'Ada',
      email: 'ada@example.com',
      image: 'https://img/1',
      emailVerified: new Date('2026-01-02T00:00:00Z'),
      internalNotes: 'do not ship this to the client',
    }
    const session = projectSession(record, expires)
    expect(Object.keys(session.user ?? {}).sort()).toEqual(['email', 'id', 'image', 'name'])
    expect(session.user).toEqual({
      id: 'u1',
      name: 'Ada',
      email: 'ada@example.com',
      image: 'https://img/1',
    })
  })

  it('carries the expiry through unchanged', () => {
    const session = projectSession(
      { id: 'u1', name: null, email: null, image: null, emailVerified: null },
      expires,
    )
    expect(session.expires).toBe(expires)
  })
})

describe('userIdFromSession', () => {
  it('returns the id of a signed-in user', () => {
    const session = { user: { id: 'u1' }, expires: '' } as unknown as Session
    expect(userIdFromSession(session)).toBe('u1')
  })

  it('returns null with no session', () => {
    expect(userIdFromSession(null)).toBeNull()
  })

  // next-auth types user.id as optional, so a session can type-check without one.
  it('returns null when the session carries no id', () => {
    const session = { user: { name: 'x' }, expires: '' } as unknown as Session
    expect(userIdFromSession(session)).toBeNull()
  })
})
