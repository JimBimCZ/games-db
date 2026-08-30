import { existsSync } from 'node:fs'

if (existsSync('.env.local')) process.loadEnvFile('.env.local')

// A hundred-hour walk over a pooled connection would hold a session advisory lock across a
// transaction pooler; the direct endpoint is the one that can hold it for the whole run.
if (process.env.DATABASE_URL_UNPOOLED) process.env.DATABASE_URL = process.env.DATABASE_URL_UNPOOLED

const { closeDb } = await import('../../db/client.ts')
const { hydrate } = await import('./hydrate.ts')

const numeric = (flag: string): number | undefined => {
  const arg = process.argv.slice(2).find((a) => a.startsWith(`${flag}=`))
  if (!arg) return undefined
  const value = Number(arg.slice(flag.length + 1))
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${flag} expects a positive number, got: ${arg.slice(flag.length + 1)}`)
  }
  return value
}

const typeArg = process.argv.slice(2).find((a) => a.startsWith('--type='))?.slice('--type='.length)
if (typeArg !== undefined && typeArg !== 'game' && typeArg !== 'dlc') {
  console.error(`--type expects game or dlc, got: ${typeArg}`)
  process.exit(1)
}

const started = Date.now()
try {
  const maxDurationSeconds = numeric('--max-duration')
  const counts = await hydrate({
    maxRequests: numeric('--max-requests'),
    maxDurationMs: maxDurationSeconds === undefined ? undefined : maxDurationSeconds * 1000,
    appid: numeric('--appid'),
    type: typeArg,
  })
  console.log(
    `hydrated ${counts.ok} ok, ${counts.unavailable} unavailable, ${counts.failed} failed ` +
      `of ${counts.attempted} attempted in ${((Date.now() - started) / 1000).toFixed(1)}s`,
  )
} catch (err) {
  console.error('hydration failed:', err)
  process.exitCode = 1
} finally {
  await closeDb()
}
