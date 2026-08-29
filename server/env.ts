import 'server-only'
import { z } from 'zod'

const schema = z.object({
  DATABASE_URL: z.string({ error: 'DATABASE_URL is not set' }).min(1, 'DATABASE_URL is not set'),
  STEAM_COUNTRY_CODE: z.string().default('cz'),
})

export function parseServerEnv(env: Record<string, string | undefined>) {
  const parsed = schema.parse(env)
  return {
    databaseUrl: parsed.DATABASE_URL,
    steamCountryCode: parsed.STEAM_COUNTRY_CODE,
  }
}

export function serverEnv() {
  return parseServerEnv(process.env)
}
