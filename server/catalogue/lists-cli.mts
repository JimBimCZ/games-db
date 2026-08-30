import { existsSync } from 'node:fs'

if (existsSync('.env.local')) process.loadEnvFile('.env.local')

// The pooled endpoint grants the same advisory lock to two clients, so a job holding it
// there excludes nobody (M3 observations §4).
if (process.env.DATABASE_URL_UNPOOLED) process.env.DATABASE_URL = process.env.DATABASE_URL_UNPOOLED

const { closeDb } = await import('../../db/client.ts')
const { syncLists } = await import('./lists.ts')
const { STORE_LIST_KINDS } = await import('../steam/store-search.ts')
type StoreListKind = (typeof STORE_LIST_KINDS)[number]

const arg = (flag: string) =>
  process.argv.slice(2).find((a) => a.startsWith(`${flag}=`))?.slice(flag.length + 1)

const depthArg = arg('--depth')
let depth: number | undefined
if (depthArg !== undefined) {
  depth = Number(depthArg)
  if (!Number.isInteger(depth) || depth <= 0) {
    console.error(`--depth expects a positive integer, got: ${depthArg}`)
    process.exit(1)
  }
}

const kind = arg('--kind')
if (kind !== undefined && !(STORE_LIST_KINDS as readonly string[]).includes(kind)) {
  console.error(`--kind expects one of ${STORE_LIST_KINDS.join(', ')}, got: ${kind}`)
  process.exit(1)
}

const started = Date.now()
try {
  const counts = await syncLists({ depth, kind: kind as StoreListKind | undefined })
  const total = Object.values(counts).reduce((a, b) => a + b, 0)
  console.log(
    `synced ${total} list entries in ${((Date.now() - started) / 1000).toFixed(1)}s: ` +
      Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(', '),
  )
} catch (err) {
  // Logging the error object rather than its message preserves `cause`.
  console.error('list sync failed:', err)
  process.exitCode = 1
} finally {
  await closeDb()
}
