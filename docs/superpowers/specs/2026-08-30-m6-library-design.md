# M6 — Library and wishlist — Design

Date: 2026-08-30
Status: approved for implementation planning

M1 created `library_entry` and `library_status_event` and applied them to Neon. Nothing has
ever written to either. The sidebar has shipped six links to `/library` since M1
(`components/sidebar.tsx:6-16`) and all six 404.

Counted live against Neon on 2026-08-30, after the M5 merge:

```
users 1 · library_entry 0 · library_status_event 0
game 552 · price 262 (all EUR) · 290 hydrated games carry no price row
```

M6 is a read-write milestone — the first one in this project. It adds **no migration**, no
Steam call, and no new dependency.

---

## 1. Scope

- `/library`: a dense sortable table, filtered by the `?status=` the sidebar already sends.
- An optimistic status control on three surfaces: the detail page, library rows, and browse
  cards.
- Wishlist price deltas against the price captured when the game was wishlisted.
- A one-line status history on the detail page — "Finished in March 2026".

The **toolbar view switcher** that M4 deferred here (`2026-08-30-m4-browse-design.md:299`)
is cancelled rather than built. A library wants columns; a grid is a discovery affordance,
and a second layout is cost without a reader.

---

## 2. Module boundaries

```
server/library/params.ts      Zod: status filter, sort key, direction
server/library/transition.ts  pure: current entry + requested status → the writes to make
server/library/queries.ts     read side: statusMap(), rows(), currentStatusSince()
server/library/actions.ts     'use server' — mutations only
components/library/status-control.tsx   'use client', the one control
components/library/table.tsx            the table and its sortable headers
app/library/page.tsx, app/library/loading.tsx
```

Queries and actions are separate files for a security reason, not tidiness. Every export of
a `'use server'` file becomes a POST endpoint reachable by direct request, not only through
our UI — the Next.js docs warn about this explicitly
(`01-app/01-getting-started/07-mutating-data.md`, the warning under "What are Server
Functions?"). A read helper must never be exported from that file.

`transition.ts` holds the mutation *rules* as a pure function so they can be tested without
a database, which is what keeps M6's test cost in line with M4's and M5's.

---

## 3. Read side

`libraryStatusMap()` returns `Map<appid, LibraryStatus>`, or `null` when there is no
session:

```sql
select appid, status from library_entry where user_id = $1
```

It is wrapped in React's `cache()` so Discover's four grids issue it once, and it carries
the same `await connection()` guard `server/browse/queries.ts` uses. Without that guard it
runs during the build's prerender pass, where there is no `DATABASE_URL` — the failure M4
already fixed once in `4366c97`.

**`CardGrid` calls it, not the pages.** `components/card-grid.tsx` is a plain server
component; making it `async` and resolving the map there means **no change to any of the
seven browse pages**, and `cache()` collapses the repeat calls. A signed-out request gets
`null` and renders exactly today's markup.

A personal library is hundreds of rows. Joining `library_entry` into each of M4's browse
queries would make every one of them user-aware, and each would then need a signed-out
path, to avoid a round trip we can afford.

---

## 4. The status control

One `'use client'` component, rendered as a **native `<select>`** styled as a macOS pop-up
button. Native buys keyboard operation, screen-reader semantics, and touch behaviour for
free; a custom menu would be several hundred lines re-earning them.

Options are the five statuses, plus `Remove from library` when an entry exists. With no
entry the control reads `Add to Library`. It is not rendered at all when there is no
session, so a signed-out visitor sees today's page unchanged.

Optimism follows the Next 16 pattern in `01-app/02-guides/interactive-apps.md:141-176` —
`useOptimistic(status)` with `startTransition`. The rollback works **because the action
returns a discriminated result instead of throwing**: that guide notes a Server Function
that throws inside a transition forwards to the nearest error boundary, which replaces the
page rather than rolling a control back. On `{ ok: false }` nothing revalidates, so the
prop is unchanged and the optimistic value reverts when the transition ends; the control
renders the message in an `aria-live` region beside itself.

Each control's accessible name includes the game title — `Library status for Hades II` —
because a browse page renders dozens of them.

**`GameCard` is restructured.** Its `<Link>` currently wraps the entire card
(`components/game-card.tsx:32`), and a `<button>` inside an `<a>` is invalid HTML. The link
will wrap the art and title only, with the control an absolutely-positioned sibling inside
a `relative` wrapper.

---

## 5. Mutations

Two actions: `setStatus(appid, status)` and `removeFromLibrary(appid)`. Both, in order:

1. `auth()` first. These are public POST endpoints.
2. Zod-validate `appid` and `status` (`z.enum(libraryStatus.enumValues)`).
3. Confirm the appid exists in `game`. `library_entry` deliberately carries **no foreign
   key** on `appid` — the same reasoning as `price_history`: a re-hydration or a prune of
   delisted apps must not cascade a user's library away. Nothing else stops a direct POST
   writing junk appids.
4. Scope every write by the session's `user_id`. The client sends an appid, never an entry
   id, so there is no row a caller can name that isn't theirs.

### 5.1 Atomicity without a transaction

`db/client.ts:11-13` omits `transaction` from the shared `Db` type because the neon-http
driver used on Vercel has none, and `getJobDb()` throws unless the driver is
node-postgres. Request-path code therefore **cannot open a transaction**, and the entry
upsert and its history row must still land together or not at all.

The write is one statement, using a CTE — a single statement is atomic in Postgres on
either driver:

```sql
with upserted as (
  insert into library_entry (user_id, appid, status, price_seen_minor, price_seen_currency)
  values (...)
  on conflict (user_id, appid) do update set status = ..., updated_at = now(), ...
  where library_entry.status is distinct from excluded.status
  returning id, status
)
insert into library_status_event (entry_id, status)
select id, status from upserted
```

The `where` clause on the conflict branch makes re-selecting the current status a no-op:
without it the history fills with duplicate rows every time the control is touched. A
no-op returns `{ ok: true }` and writes nothing.

The exact CTE, and whether Drizzle's `db.execute` carries it unchanged to both drivers, is
to be verified during implementation and its output pasted. It is written here as intent,
not as an observed result.

`removeFromLibrary` needs none of this: it is a single
`delete from library_entry where user_id = $1 and appid = $2`, and the events go with it
through the `on delete cascade` already on `library_status_event.entry_id`. Removing a
game discards its history — the entry is gone, so there is nothing for the history to
describe.

### 5.2 Price capture

`price_seen_minor` and `price_seen_currency` are written on **every transition into
`wishlist`**, overwriting whatever was there. Moving a game to backlog and later
re-wishlisting it restarts the delta, which is what "the price when I wishlisted it"
means. Transitions into the other four statuses leave both fields alone.

The values are read from the `price` row for the configured `cc` at write time. 290 of 552
hydrated games have no price row, so both fields stay null in that case and the row simply
shows no delta.

### 5.3 Revalidation

`revalidatePath('/library')` on a successful write: that page's row set and ordering
change. `cacheComponents` is off in `next.config.ts`, so `updateTag` — which the Next 16
revalidation guide scopes to Cache Components — is not the applicable API here. The page
the user is looking at is covered by the optimistic value. Whether the client router cache
also needs clearing for a back-navigation to show the new status is to be checked during
implementation, not assumed.

---

## 6. `/library`

Signed out redirects to `/signin`. Columns:

| Column | Content |
|---|---|
| Game | capsule art plus title, linking to `/game/[appid]` |
| Status | the control from §4 |
| Added | `added_at`, formatted short |
| Price | current price **with its discount context**, per CLAUDE.md |
| Since added | wishlist rows only — see below |

**Sorting** is `?sort=name\|added\|price\|status&dir=asc\|desc`, rendered as plain server
links in the `<th>`, with `aria-sort` on the sorted column. No client state. Default is
`added` descending.

**Filtering** is `?status=`, which is exactly what the six sidebar links already send. An
unrecognised value falls back to all rows rather than erroring.

**The delta** compares the current `final_minor` against `price_seen_minor`, shown as
`↓ €8.00 since added`. It renders **only when the stored currency equals the current row's
currency**. We never convert — CLAUDE.md is explicit — and although `price` holds a single
currency today (EUR, 262 rows), the column exists per-row precisely because that can change.

**Empty states**, three of them: an empty library, a filter matching nothing, and an entry
whose `game` row has since disappeared. The third is real because there is no foreign key
(§5); the row renders from the entry alone, with the appid and no art.

**No pagination.** A personal library is small. The query takes a hard 500-row cap and this
document says so rather than implying the page scales.

---

## 7. Detail page

The right rail gains, under `PriceCard`: the status control, then the history line.

The history line reads the most recent `library_status_event` whose status equals the
entry's current status, and renders `Finished in March 2026`. An entry with no matching
event renders nothing. Wishlist entries show the same delta as §6.

---

## 8. Error handling

Expected failures — no session, unknown appid, invalid status, an appid absent from `game`
— return `{ ok: false, error }` and never throw, per §4. Unexpected database errors are
logged server-side and returned as the same shape; the message shown to the user names the
failure without leaking the cause.

---

## 9. Testing

Vitest, all pure, no database — consistent with M4's decision to skip database-backed
integration tests on a personal project:

- `params` — every valid status, an unknown status, unknown sort keys, both directions,
  and a missing parameter.
- `transition` — a new entry, a status change, a same-status no-op, capture on entering
  wishlist, and re-capture on wishlist → backlog → wishlist.
- The delta — price down, up, equal, no `price_seen`, and **mismatched currency returning
  null**.
- The history line, including an entry with no matching event.

Playwright has no signed-in session (`e2e/smoke.spec.ts` is entirely anonymous), so it gets
only what anonymous can prove: `/library` redirects to `/signin`, and no status control
appears on a browse card. Signed-in behaviour — add, change, remove, the wishlist delta,
the history line, and a rollback on a forced failure — is a manual pass against the real
database with output pasted, the standard M4 and M5 both held.

---

## 10. Out of scope

- The toolbar view switcher. Cancelled, per §1.
- Price-drop notifications or any email.
- Notes, ratings, playtime, or per-entry ordering.
- Bulk edit and multi-select.
- Importing a real Steam account's owned games.
- Pagination on `/library`.
- Any schema change, migration, or job change. M6 touches neither hydration nor pricing.

---

## 11. PR split

**PR 1 — mutations and the control.** `server/library/{params,transition,queries,actions}`,
the status control, the detail-page integration, and the history line.

**PR 2 — the library page.** The table, sorting, filters, the delta, the three empty
states, the skeleton, and the `CardGrid` integration that puts the control on browse cards.

---

## 12. Definition of done

`pnpm build`, `pnpm lint`, `pnpm typecheck` and `pnpm test` pass with output pasted. The
CTE of §5.1 is run against the real database and its behaviour — including the no-op branch
— shown. `/library` is exercised signed in across all six sidebar filters and every sort
column, with output pasted. Every claim in the completion report states plainly whether it
was verified or not.
