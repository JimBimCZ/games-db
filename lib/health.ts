export type HealthReport = {
  status: 'ok' | 'degraded'
  database: 'ok' | 'unavailable'
}

export async function checkHealth(probe: () => Promise<unknown>): Promise<HealthReport> {
  try {
    await probe()
    return { status: 'ok', database: 'ok' }
  } catch {
    return { status: 'degraded', database: 'unavailable' }
  }
}
