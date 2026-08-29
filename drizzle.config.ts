import { existsSync } from 'node:fs'
import { defineConfig } from 'drizzle-kit'

// drizzle-kit runs outside Next, which is what normally loads .env.local.
if (existsSync('.env.local')) process.loadEnvFile('.env.local')

export default defineConfig({
  dialect: 'postgresql',
  schema: './db/schema.ts',
  out: './db/migrations',
  dbCredentials: { url: process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL! },
})
