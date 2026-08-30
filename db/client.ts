import 'server-only'
import { neon } from '@neondatabase/serverless'
import { drizzle as drizzleNeon } from 'drizzle-orm/neon-http'
import { drizzle as drizzlePg, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import * as schema from './schema.ts'

export type DriverName = 'neon-http' | 'node-postgres'

// neon-http has no transaction support, so the shared type can't offer one either — a call
// site that compiles must actually work on both drivers.
export type Db = Omit<NodePgDatabase<typeof schema>, 'transaction'>

export function resolveDriver(env: Record<string, string | undefined>): DriverName {
  const explicit = env.DB_DRIVER
  if (explicit) {
    if (explicit !== 'neon-http' && explicit !== 'node-postgres') {
      throw new Error(`Unsupported DB_DRIVER: ${explicit}`)
    }
    return explicit
  }
  return env.VERCEL ? 'neon-http' : 'node-postgres'
}

let instance: Db | undefined
let pool: Pool | undefined

function createDb(): Db {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is not set')

  if (resolveDriver(process.env) === 'neon-http') {
    return drizzleNeon(neon(url), { schema }) as unknown as Db
  }

  pool = new Pool({ connectionString: url })
  // An unhandled 'error' on the Pool is an uncaught exception that kills the process: idle
  // clients emit it when the backend drops them, out of band from any query's try/catch.
  pool.on('error', (err) => console.error('postgres idle client error:', err.message))
  return drizzlePg(pool, { schema })
}

// next build evaluates route modules during page-data collection, so constructing at module
// load fails any build without DATABASE_URL — including every Docker build stage.
export function getDb(): Db {
  instance ??= createDb()
  return instance
}

// A CLI job holding an open pool never exits. Serverless callers never need this.
export async function closeDb(): Promise<void> {
  const poolToClose = pool
  pool = undefined
  instance = undefined

  if (poolToClose) {
    try {
      await poolToClose.end()
    } catch {
      // Ignore close errors. We've cleared pool and instance above, so a stale
      // client won't be returned by getDb(). Swallowing the error here prevents
      // close failures from masking the actual error that triggered closeDb.
    }
  }
}
