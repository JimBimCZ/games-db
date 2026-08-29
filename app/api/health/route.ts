import { sql } from 'drizzle-orm'
import { getDb } from '@/db/client'
import { checkHealth } from '@/lib/health'

export const dynamic = 'force-dynamic'

export async function GET() {
  const report = await checkHealth(() => getDb().execute(sql`select 1`))
  return Response.json(report, { status: report.status === 'ok' ? 200 : 503 })
}
