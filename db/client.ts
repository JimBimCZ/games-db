import 'server-only'
import { neon } from '@neondatabase/serverless'
import { drizzle as drizzleNeon } from 'drizzle-orm/neon-http'
import { drizzle as drizzlePg, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import * as schema from './schema'

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

function createDb(): Db {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is not set')

  if (resolveDriver(process.env) === 'neon-http') {
    return drizzleNeon(neon(url), { schema }) as unknown as Db
  }

  return drizzlePg(new Pool({ connectionString: url }), { schema })
}

let instance: Db | undefined

// next build evaluates route modules during page-data collection, so constructing at module
// load fails any build without DATABASE_URL — including every Docker build stage.
export function getDb(): Db {
  instance ??= createDb()
  return instance
}
