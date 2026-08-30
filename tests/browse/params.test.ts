import { describe, expect, it } from 'vitest'
import { parseAppid, parseGenreId, parsePage, parseSearchQuery } from '@/server/browse/params'

describe('parseSearchQuery', () => {
  it('trims and accepts a usable term', () => {
    expect(parseSearchQuery('  witcher ')).toBe('witcher')
  })

  it('rejects anything shorter than two characters', () => {
    expect(parseSearchQuery('a')).toBeNull()
    expect(parseSearchQuery('   ')).toBeNull()
    expect(parseSearchQuery(undefined)).toBeNull()
  })

  it('rejects an over-long term rather than truncating it', () => {
    expect(parseSearchQuery('x'.repeat(101))).toBeNull()
  })
})

describe('parsePage', () => {
  it('defaults to the first page', () => {
    expect(parsePage(undefined)).toBe(1)
    expect(parsePage('')).toBe(1)
  })

  it('accepts a positive integer', () => {
    expect(parsePage('4')).toBe(4)
  })

  it('falls back to the first page for junk', () => {
    expect(parsePage('0')).toBe(1)
    expect(parsePage('-2')).toBe(1)
    expect(parsePage('two')).toBe(1)
    expect(parsePage('1.5')).toBe(1)
  })
})

describe('parseGenreId', () => {
  it('accepts a numeric id', () => {
    expect(parseGenreId('23')).toBe('23')
  })

  it('rejects anything else', () => {
    expect(parseGenreId('23; drop table game')).toBeNull()
    expect(parseGenreId('')).toBeNull()
  })
})

describe('parseAppid', () => {
  it('accepts an in-range appid', () => {
    expect(parseAppid('570')).toBe(570)
  })

  // game.appid is int4; a larger value reaches Postgres and raises 22003 rather than 404ing.
  it('rejects a value past the int4 ceiling', () => {
    expect(parseAppid('99999999999')).toBeNull()
  })

  it('rejects anything that is not a positive whole number', () => {
    expect(parseAppid('0')).toBeNull()
    expect(parseAppid('-5')).toBeNull()
    expect(parseAppid('1.5')).toBeNull()
    expect(parseAppid('abc')).toBeNull()
    expect(parseAppid('')).toBeNull()
  })
})
