export type HealthReport = {
  status: 'ok' | 'degraded'
  database: 'ok' | 'unavailable'
}

export async function checkHealth(probe: () => Promise<unknown>): Promise<HealthReport> {
  try {
    await probe()
    return { status: 'ok', database: 'ok' }
  } catch (err) {
    console.error('health probe failed:', err instanceof Error ? err.message : 'non-Error thrown')
    return { status: 'degraded', database: 'unavailable' }
  }
}
