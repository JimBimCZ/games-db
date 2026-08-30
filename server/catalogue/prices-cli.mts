import { existsSync } from 'node:fs'

if (existsSync('.env.local')) process.loadEnvFile('.env.local')
if (process.env.DATABASE_URL_UNPOOLED) process.env.DATABASE_URL = process.env.DATABASE_URL_UNPOOLED

const { closeDb } = await import('../../db/client.ts')
const { refreshPrices } = await import('./prices.ts')

const numeric = (flag: string): number | undefined => {
  const arg = process.argv.slice(2).find((a) => a.startsWith(`${flag}=`))
  if (!arg) return undefined
  const value = Number(arg.slice(flag.length + 1))
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${flag} expects a positive number, got: ${arg.slice(flag.length + 1)}`)
  }
  return value
}

const started = Date.now()
try {
  const maxDurationSeconds = numeric('--max-duration')
  const counts = await refreshPrices({
    maxRequests: numeric('--max-requests'),
    maxDurationMs: maxDurationSeconds === undefined ? undefined : maxDurationSeconds * 1000,
  })
  console.log(
    `refreshed ${counts.written} prices (${counts.changed} changed) across ${counts.batches} batches ` +
      `in ${((Date.now() - started) / 1000).toFixed(1)}s`,
  )
} catch (err) {
  console.error('price refresh failed:', err)
  process.exitCode = 1
} finally {
  await closeDb()
}
