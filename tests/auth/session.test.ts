import { describe, expect, it } from 'vitest'
import { projectSession } from '@/server/auth/session'

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
