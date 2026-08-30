'use server'
import { randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { refresh, revalidatePath } from 'next/cache'
import { getDb } from '../../db/client.ts'
import { currentUserId } from '../auth/current-user.ts'
import { serverEnv } from '../env.ts'
import { parseAppidInput, parseStatus } from './params.ts'
import { planTransition } from './transition.ts'

export type LibraryResult = { ok: true } | { ok: false; error: string }

const SIGN_IN = 'Sign in to use your library.'
const SAVE_FAILED = 'Could not save that. Try again.'

// The upsert and its history row must land together, and the request path has no
// transaction: db/client.ts omits it from Db because neon-http cannot offer one. A single
// statement is atomic on either driver.
//
// Three things this statement does that are easy to lose in a rewrite:
//   - it supplies both ids, because Drizzle's $defaultFn is client-side only and neither
//     id column has a database default;
//   - `where exists` rejects an appid absent from the catalogue, which nothing else does:
//     this is a public POST endpoint and library_entry has no foreign key on appid;
//   - `where ... is distinct from` makes re-selecting the current status write nothing,
//     which is what stops the history filling with duplicates.
//
// Verified live against Neon on 2026-08-30 in a rolled-back transaction.
function upsertStatement(args: {
  entryId: string
  eventId: string
  userId: string
  appid: number
  status: string
  priceMinor: number | null
  priceCurrency: string | null
}) {
  return sql`
    with upserted as (
      insert into library_entry (id, user_id, appid, status, price_seen_minor, price_seen_currency)
      select ${args.entryId}, ${args.userId}, ${args.appid}, ${args.status}::library_status,
             ${args.priceMinor}::int, ${args.priceCurrency}::text
      where exists (select 1 from game where appid = ${args.appid})
      on conflict (user_id, appid) do update
        set status = excluded.status,
            updated_at = now(),
            price_seen_minor = case when excluded.status = 'wishlist'
              then excluded.price_seen_minor else library_entry.price_seen_minor end,
            price_seen_currency = case when excluded.status = 'wishlist'
              then excluded.price_seen_currency else library_entry.price_seen_currency end
        where library_entry.status is distinct from excluded.status
      returning id, status
    )
    insert into library_status_event (id, entry_id, status)
    select ${args.eventId}, id, status from upserted
    returning entry_id
  `
}

// refresh() covers whichever page invoked the action. Without it a successful change on the
// detail page snaps back: useOptimistic reverts to the server prop when the transition
// ends, and only a re-render replaces that prop. revalidatePath covers the other page,
// whose row set and ordering also change.
function settled(): void {
  refresh()
  revalidatePath('/library')
}

export async function setLibraryStatus(
  rawAppid: unknown,
  rawStatus: unknown,
): Promise<LibraryResult> {
  const userId = await currentUserId()
  if (!userId) return { ok: false, error: SIGN_IN }

  const appid = parseAppidInput(rawAppid)
  const status = parseStatus(rawStatus)
  if (appid === null || status === null) return { ok: false, error: SAVE_FAILED }

  const db = getDb()
  const cc = serverEnv().steamCountryCode

  try {
    const existing = await db.execute(
      sql`select status from library_entry where user_id = ${userId} and appid = ${appid}`,
    )
    const current = await db.execute(
      sql`select final_minor, currency from price where appid = ${appid} and cc = ${cc}`,
    )

    const priceRow = current.rows[0]
    const plan = planTransition(
      parseStatus(existing.rows[0]?.status),
      status,
      priceRow
        ? { finalMinor: Number(priceRow.final_minor), currency: String(priceRow.currency) }
        : null,
    )

    if (plan.kind === 'noop') return { ok: true }

    const result = await db.execute(
      upsertStatement({
        entryId: randomUUID(),
        eventId: randomUUID(),
        userId,
        appid,
        status: plan.status,
        priceMinor: plan.priceSeen?.minor ?? null,
        priceCurrency: plan.priceSeen?.currency ?? null,
      }),
    )

    // No rows means the `where exists` rejected the appid.
    if (result.rows.length === 0) {
      return { ok: false, error: 'That game is not in the catalogue.' }
    }

    settled()
    return { ok: true }
  } catch (error) {
    console.error('library setLibraryStatus failed:', error)
    return { ok: false, error: SAVE_FAILED }
  }
}

export async function removeFromLibrary(rawAppid: unknown): Promise<LibraryResult> {
  const userId = await currentUserId()
  if (!userId) return { ok: false, error: SIGN_IN }

  const appid = parseAppidInput(rawAppid)
  if (appid === null) return { ok: false, error: SAVE_FAILED }

  try {
    // The status events go with it: library_status_event.entry_id cascades on delete.
    await getDb().execute(
      sql`delete from library_entry where user_id = ${userId} and appid = ${appid}`,
    )
    settled()
    return { ok: true }
  } catch (error) {
    console.error('library removeFromLibrary failed:', error)
    return { ok: false, error: SAVE_FAILED }
  }
}
