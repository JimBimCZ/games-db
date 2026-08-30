import { existsSync } from 'node:fs'

if (existsSync('.env.local')) process.loadEnvFile('.env.local')

const { closeDb } = await import('../../db/client.ts')
const { syncCatalogue } = await import('./sync.ts')
const { parseSince } = await import('./since.ts')

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
  // Logging the message alone discards `cause` (e.g. the original network fault
  // behind a retried fetch); logging the error object preserves it.
  console.error('catalogue sync failed:', err)
  process.exitCode = 1
} finally {
  await closeDb()
}
