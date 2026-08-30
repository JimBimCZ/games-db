import { describe, expect, it } from 'vitest'
import { chunk } from '@/server/catalogue/sync'

describe('chunk', () => {
  it('splits into batches of the requested size', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]])
  })

  it('returns nothing for an empty list', () => {
    expect(chunk([], 100)).toEqual([])
  })

  it('returns a single batch when the list is smaller than the size', () => {
    expect(chunk([1, 2], 100)).toEqual([[1, 2]])
  })
})
