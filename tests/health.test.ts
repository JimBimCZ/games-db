import { describe, expect, it } from 'vitest'
import { checkHealth } from '@/lib/health'

describe('checkHealth', () => {
  it('reports ok when the database answers', async () => {
    expect(await checkHealth(async () => 1)).toEqual({ status: 'ok', database: 'ok' })
  })

  it('reports degraded rather than throwing when the database is unreachable', async () => {
    const result = await checkHealth(async () => {
      throw new Error('connection refused')
    })
    expect(result).toEqual({ status: 'degraded', database: 'unavailable' })
  })
})
