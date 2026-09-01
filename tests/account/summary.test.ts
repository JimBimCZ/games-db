import { describe, expect, it } from 'vitest'
import { describeAccount, entryCountLabel } from '@/lib/account/summary'

describe('describeAccount', () => {
  it('prefers the name for display', () => {
    expect(describeAccount({ name: 'Ada', email: 'ada@example.com' }, 3)).toEqual({
      displayName: 'Ada',
      email: 'ada@example.com',
      entryCount: 3,
    })
  })

  it('falls back to the email when GitHub gave no name', () => {
    expect(describeAccount({ name: null, email: 'ada@example.com' }, 0).displayName).toBe(
      'ada@example.com',
    )
  })

  it('falls back again when there is neither', () => {
    expect(describeAccount({ name: null, email: null }, 0).displayName).toBe('Your account')
  })

  it('treats a blank name as absent', () => {
    expect(describeAccount({ name: '   ', email: 'ada@example.com' }, 0).displayName).toBe(
      'ada@example.com',
    )
  })

  it('carries no field the page was not given', () => {
    const record = { name: 'Ada', email: 'ada@example.com', image: 'https://img/1' }
    expect(Object.keys(describeAccount(record, 1)).sort()).toEqual([
      'displayName',
      'email',
      'entryCount',
    ])
  })
})

describe('entryCountLabel', () => {
  it('singularises one entry', () => {
    expect(entryCountLabel(1)).toBe('1 library entry')
  })

  it('pluralises everything else', () => {
    expect(entryCountLabel(47)).toBe('47 library entries')
  })

  it('spells out an empty library, because "0 library entries" reads like an error', () => {
    expect(entryCountLabel(0)).toBe('No library entries')
  })
})
