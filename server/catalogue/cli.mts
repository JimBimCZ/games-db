import { existsSync } from 'node:fs'

if (existsSync('.env.local')) process.loadEnvFile('.env.local')

const { closeDb } = await import('../../db/client.ts')
const { syncCatalogue } = await import('./sync.ts')

function parseSince(argv: string[]): number | undefined {
  const arg = argv.find((a) => a.startsWith('--since='))
  if (!arg) return undefined

  const value = arg.slice('--since='.length)
  const days = Number(value)
  if (Number.isFinite(days) && days > 0) return Math.floor(Date.now() / 1000) - days * 86400

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) throw new Error(`--since expects a day count or an ISO date, got: ${value}`)
  return Math.floor(date.getTime() / 1000)
}

const key = process.env.STEAM_API_KEY
if (!key) {
  console.error('STEAM_API_KEY is not set. GetAppList returns 403 without it.')
  process.exit(1)
}

const started = Date.now()
try {
  const counts = await syncCatalogue({ key, ifModifiedSince: parseSince(process.argv.slice(2)) })
  console.log(
    `synced ${counts.total} appids (${counts.games} games, ${counts.dlc} dlc) ` +
      `in ${((Date.now() - started) / 1000).toFixed(1)}s`,
  )
} catch (err) {
  console.error('catalogue sync failed:', err instanceof Error ? err.message : err)
  process.exitCode = 1
} finally {
  await closeDb()
}
