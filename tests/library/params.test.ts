import { describe, expect, it } from 'vitest'
import {
  parseAppidInput,
  parseDir,
  parseSort,
  parseStatus,
  parseStatusFilter,
} from '@/server/library/params'

describe('parseStatusFilter', () => {
  it('accepts every status the sidebar links to', () => {
    expect(parseStatusFilter('playing')).toBe('playing')
    expect(parseStatusFilter('backlog')).toBe('backlog')
    expect(parseStatusFilter('finished')).toBe('finished')
    expect(parseStatusFilter('abandoned')).toBe('abandoned')
    expect(parseStatusFilter('wishlist')).toBe('wishlist')
  })

  it('treats a missing or unknown filter as no filter', () => {
    expect(parseStatusFilter(undefined)).toBeNull()
    expect(parseStatusFilter('')).toBeNull()
    expect(parseStatusFilter('Playing')).toBeNull()
    expect(parseStatusFilter('deleted')).toBeNull()
  })
})

describe('parseStatus', () => {
  it('accepts a valid status', () => {
    expect(parseStatus('wishlist')).toBe('wishlist')
  })

  // This is the mutation boundary; these are the shapes a direct POST can send.
  it('rejects anything else', () => {
    expect(parseStatus('nonsense')).toBeNull()
    expect(parseStatus(undefined)).toBeNull()
    expect(parseStatus(null)).toBeNull()
    expect(parseStatus(7)).toBeNull()
    expect(parseStatus({ status: 'playing' })).toBeNull()
  })
})

describe('parseSort', () => {
  it('accepts the four sortable columns', () => {
    expect(parseSort('name')).toBe('name')
    expect(parseSort('added')).toBe('added')
    expect(parseSort('price')).toBe('price')
    expect(parseSort('status')).toBe('status')
  })

  it('defaults to added', () => {
    expect(parseSort(undefined)).toBe('added')
    expect(parseSort('appid')).toBe('added')
  })
})

describe('parseDir', () => {
  it('accepts both directions', () => {
    expect(parseDir('asc')).toBe('asc')
    expect(parseDir('desc')).toBe('desc')
  })

  it('defaults to descending', () => {
    expect(parseDir(undefined)).toBe('desc')
    expect(parseDir('sideways')).toBe('desc')
  })
})

describe('parseAppidInput', () => {
  it('accepts a positive integer', () => {
    expect(parseAppidInput(570)).toBe(570)
    expect(parseAppidInput('570')).toBe(570)
  })

  it('rejects junk', () => {
    expect(parseAppidInput(0)).toBeNull()
    expect(parseAppidInput(-1)).toBeNull()
    expect(parseAppidInput(1.5)).toBeNull()
    expect(parseAppidInput('abc')).toBeNull()
    expect(parseAppidInput(undefined)).toBeNull()
  })
})
