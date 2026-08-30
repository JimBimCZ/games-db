import { describe, expect, it } from 'vitest'
import { libraryStatus } from '@/db/schema'
import { LIBRARY_STATUSES, STATUS_LABELS } from '@/lib/library/statuses'

describe('LIBRARY_STATUSES', () => {
  // The control is a client component and cannot import the schema, so this list is
  // hand-written. This test is the only thing stopping it drifting from the enum.
  it('matches the schema enum exactly, in order', () => {
    expect([...LIBRARY_STATUSES]).toEqual([...libraryStatus.enumValues])
  })

  it('labels every status', () => {
    for (const status of LIBRARY_STATUSES) {
      expect(STATUS_LABELS[status]).toBeTruthy()
    }
  })
})
