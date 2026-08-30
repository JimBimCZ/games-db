# M3 Steam Client and Hydration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the 245,000 pending rows in `steam_app` into queryable `game`, `game_media`, `genre`, `category` and `price` rows, through a rate-limited Steam client and a resumable background worker.

**Architecture:** One per-host token-bucket limiter fronts every storefront request. Zod parsers validate each payload against fixtures captured live. A read-through cache helper serves stale data on error. A long-running worker walks `steam_app` under a Postgres advisory lock, ordered games-first and most-recently-modified-first, writing each app in a single transaction and backing off on failure.

**Tech Stack:** TypeScript, Next.js 16 (App Router), Drizzle ORM, Neon Postgres, Zod 4, Vitest, `isomorphic-dompurify`.

**Spec:** `docs/superpowers/specs/2026-08-30-m3-hydration-design.md` — read it before starting. It records what was decided and, in §8, what is not yet known.

## Global Constraints

- **Prove before asserting.** Never state that something works, exists, or is fixed without evidence produced in the same session: a command you ran and its output, a file you read, or a test that passed. `CLAUDE.md` lists the exact phrases that are prohibited without evidence.
- **No unnecessary comments.** A comment must record why a non-obvious choice was made, link a source justifying a magic value, or warn about a sharp edge. Never restate the code below it. Delete any comment you would not defend in review.
- **No new dependencies** beyond the one this plan installs (`isomorphic-dompurify`, already approved in the M1 design). If a task seems to need another, stop and ask.
- **Never one Steam request per item in a list.** All browse and list queries read our own tables.
- **Every Steam call is server-side**, goes through `steamFetchJson`, and carries `cc` and `l`. Nothing calls `fetch` against Steam directly.
- **Prices:** read the minor-unit integers (`initial`, `final`), never the formatted strings. Read `currency` from the payload; `cc=cz` returns EUR. Store currency alongside every amount.
- **Image URLs are read from payloads, never constructed.** Capsule paths contain a per-app hash segment.
- **Review data:** aggregates only. `num_per_page=0&purchase_type=all`. Review bodies and author identifiers are never fetched, stored, or rendered.
- **Working agreement:** branch → commit → push → `gh pr create`. Nothing is pushed straight to `main`.
- Verification commands: `pnpm build`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:db`.

---

## File Structure

| File | Responsibility |
|---|---|
| `server/steam/limiter.ts` | **Create.** Token bucket; one instance per Steam host |
| `server/steam/client.ts` | **Modify.** Acquire a token and apply a timeout before each fetch |
| `server/steam/schemas.ts` | **Create.** Zod parsers for `appdetails`, `price_overview`, `appreviews` |
| `server/steam/ttl.ts` | **Create.** Every freshness window, in one object |
| `server/steam/cache.ts` | **Create.** Read-through helper; serves stale on error |
| `server/steam/app-details.ts` | **Create.** Builds the `appdetails` URLs and calls the client |
| `server/steam/reviews.ts` | **Create.** Builds the `appreviews` URL and calls the client |
| `server/catalogue/map-app-details.ts` | **Create.** Payload → row objects; sanitisation happens here |
| `server/catalogue/hydrate-write.ts` | **Create.** The per-app transaction |
| `server/catalogue/queue.ts` | **Create.** Due-row selection, backoff, state transitions, advisory lock |
| `server/catalogue/hydrate.ts` | **Create.** The run loop and its budget |
| `server/catalogue/hydrate-cli.mts` | **Create.** `pnpm hydrate` entry point |
| `server/catalogue/prices.ts` | **Create.** Batched price refresh and history append |
| `server/catalogue/prices-cli.mts` | **Create.** `pnpm refresh:prices` entry point |
| `db/schema.ts` | **Modify.** Two columns on `steam_app`, one index change |
| `db/client.ts` | **Modify.** Add `getJobDb()` |
| `server/env.ts` | **Modify.** `STEAM_STOREFRONT_RPS`, `STEAM_LANGUAGE` |
| `server/steam/app-list.ts` | **Modify.** Carry `price_change_number` |
| `server/catalogue/sync.ts` | **Modify.** Write the two new columns |

---

## Task 1: Capture live evidence

This task produces no application code. It produces the observations every later task depends on, and it must be completed first — the parsers in Task 4 are written against these fixtures, not against anyone's memory of the payload.

**This task stays in the main session.** It is judgement work against undocumented endpoints, and a wrong-but-confident answer here is expensive.

**Files:**
- Create: `tests/fixtures/steam/appdetails-620.json` (priced game)
- Create: `tests/fixtures/steam/appdetails-570.json` (free game)
- Create: `tests/fixtures/steam/appdetails-1174180.json` (discounted game with movies)
- Create: `tests/fixtures/steam/appdetails-323180.json` (non-game type: music)
- Create: `tests/fixtures/steam/appdetails-missing.json` (`success: false`)
- Create: `tests/fixtures/steam/price-overview-batch.json`
- Create: `tests/fixtures/steam/appreviews-620.json`
- Create: `docs/superpowers/specs/2026-08-30-m3-observations.md`

**Interfaces:**
- Consumes: nothing.
- Produces: the seven fixture files above, and `docs/superpowers/specs/2026-08-30-m3-observations.md` recording the measured storefront rate (requests per second), the maximum working `filters=price_overview` batch size, and the advisory-lock-over-pooler result. Task 3 reads the rate; Task 8 reads the batch size; Task 7 reads the lock result.

- [ ] **Step 1: Capture the `appdetails` fixtures**

```bash
cd /Users/vitbusek/Documents/projects/games-db
for id in 620 570 1174180 323180; do
  curl -s "https://store.steampowered.com/api/appdetails?appids=$id&cc=cz&l=english" \
    -o "tests/fixtures/steam/appdetails-$id.json"
  sleep 2
done
curl -s "https://store.steampowered.com/api/appdetails?appids=999999999&cc=cz&l=english" \
  -o tests/fixtures/steam/appdetails-missing.json
```

- [ ] **Step 2: Confirm what each fixture actually contains**

Do not skip this. The parsers in Task 4 are written from what you see here.

```bash
for f in tests/fixtures/steam/appdetails-*.json; do
  echo "== $f"
  jq -r 'to_entries[0] | "success=\(.value.success) type=\(.value.data.type // "-") is_free=\(.value.data.is_free // "-") price=\(.value.data.price_overview.final // "-") movies=\(.value.data.movies | length // 0)"' "$f"
done
jq -r '.["620"].data | keys | join(", ")' tests/fixtures/steam/appdetails-620.json
jq -r '.["1174180"].data.movies[0] | keys | join(", ")' tests/fixtures/steam/appdetails-1174180.json
jq -r '.["620"].data.pc_requirements | type' tests/fixtures/steam/appdetails-620.json
jq -r '.["620"].data.content_descriptors' tests/fixtures/steam/appdetails-620.json
```

Record in the observations doc: the full key list, whether `pc_requirements` is an object or an array, the shape of a `movies[]` entry, and the `content_descriptors` shape. Any field in `db/schema.ts` that does not appear in any fixture must be written down as "not observed" — the parser marks it optional and the mapper writes null.

- [ ] **Step 3: Measure the storefront rate limit**

A bounded probe. It stops at the first 429 and does not continue.

```js
// /private/tmp/claude-501/-Users-vitbusek-Documents-projects-games-db/899a9675-0bda-4c09-8575-60d91c13b504/scratchpad/probe-rate.mjs
const APPIDS = [620, 570, 730, 440, 292030, 1174180, 271590, 322330, 105600, 413150]
const started = Date.now()
let sent = 0

for (const intervalMs of [1500, 1000, 750, 500, 350]) {
  for (let i = 0; i < 40; i++) {
    const appid = APPIDS[sent % APPIDS.length]
    const res = await fetch(
      `https://store.steampowered.com/api/appdetails?appids=${appid}&cc=cz&l=english`,
    )
    sent++
    const elapsed = (Date.now() - started) / 1000
    if (res.status === 429 || res.status === 403) {
      console.log(`LIMITED at status=${res.status} after ${sent} requests in ${elapsed.toFixed(1)}s`)
      console.log(`interval=${intervalMs}ms  effective=${(sent / elapsed).toFixed(2)} req/s`)
      console.log(`retry-after=${res.headers.get('retry-after')}`)
      process.exit(0)
    }
    if (sent % 20 === 0) {
      console.log(`sent=${sent} elapsed=${elapsed.toFixed(1)}s rate=${(sent / elapsed).toFixed(2)} req/s interval=${intervalMs}ms`)
    }
    await new Promise((r) => setTimeout(r, intervalMs))
  }
}
console.log(`no limit hit: ${sent} requests in ${((Date.now() - started) / 1000).toFixed(1)}s`)
```

Run: `node /private/tmp/claude-501/-Users-vitbusek-Documents-projects-games-db/899a9675-0bda-4c09-8575-60d91c13b504/scratchpad/probe-rate.mjs`

Record the exact output. The default rate for Task 3 is 60–70% of the observed sustained rate. **If no limit is hit, that is also a result** — record the highest rate reached and pin the default at 60–70% of it, not higher. Do not write a ceiling into any file that this run did not produce.

- [ ] **Step 4: Find the `filters=price_overview` batch maximum**

```js
// scratchpad/probe-batch.mjs
const POOL = [620, 570, 730, 440, 292030, 1174180, 271590, 322330, 105600, 413150,
              220, 400, 500, 550, 4000, 8930, 236850, 281990, 379720, 632360]
for (const size of [3, 5, 10, 20]) {
  const ids = Array.from({ length: size }, (_, i) => POOL[i % POOL.length]).join(',')
  const res = await fetch(
    `https://store.steampowered.com/api/appdetails?appids=${ids}&filters=price_overview&cc=cz&l=english`,
  )
  const text = await res.text()
  let returned = 'unparseable'
  try {
    const body = JSON.parse(text)
    returned = body === null ? 'null body' : Object.keys(body).length
  } catch {}
  console.log(`size=${size} status=${res.status} bytes=${text.length} keys=${returned}`)
  await new Promise((r) => setTimeout(r, 2000))
}
```

Record which sizes returned every requested key and which returned a `null` body or fewer keys. Pin Task 8's batch size below the largest that worked. Save one working response as `tests/fixtures/steam/price-overview-batch.json` — make sure it includes at least one free game so the `data: []` case is covered.

- [ ] **Step 5: Capture the reviews fixture**

```bash
curl -s "https://store.steampowered.com/appreviews/620?json=1&num_per_page=0&purchase_type=all" \
  -o tests/fixtures/steam/appreviews-620.json
jq '{success, query_summary}' tests/fixtures/steam/appreviews-620.json
jq '.reviews | length' tests/fixtures/steam/appreviews-620.json
```

The last command must print `0`. If it does not, `num_per_page=0` is not doing what the policy assumes and that is a finding to raise before going further — do not commit a fixture containing review bodies or author blocks.

- [ ] **Step 6: Test the advisory lock over both endpoints**

```js
// scratchpad/probe-lock.mjs
import { existsSync } from 'node:fs'
if (existsSync('.env.local')) process.loadEnvFile('.env.local')
import pg from 'pg'

for (const [label, url] of [
  ['pooled (DATABASE_URL)', process.env.DATABASE_URL],
  ['direct (DATABASE_URL_UNPOOLED)', process.env.DATABASE_URL_UNPOOLED],
]) {
  if (!url) { console.log(`${label}: not set`); continue }
  const a = new pg.Client({ connectionString: url })
  const b = new pg.Client({ connectionString: url })
  await a.connect(); await b.connect()
  const first = await a.query('select pg_try_advisory_lock(4801001) as locked')
  const second = await b.query('select pg_try_advisory_lock(4801001) as locked')
  const held = await a.query('select count(*)::int as n from pg_locks where locktype = $1', ['advisory'])
  console.log(`${label}: first=${first.rows[0].locked} second=${second.rows[0].locked} advisory_locks=${held.rows[0].n}`)
  await a.query('select pg_advisory_unlock(4801001)')
  await a.end(); await b.end()
}
```

Run it from the repo root. The expected correct result is `first=true second=false`. Record what each endpoint actually did. If the pooled endpoint reports `first=true second=true`, the lock is not holding across connections there and the jobs must use `DATABASE_URL_UNPOOLED` — which is the plan's default either way, but the reason recorded changes.

- [ ] **Step 7: Write the observations document**

Create `docs/superpowers/specs/2026-08-30-m3-observations.md` with, for each of the five items in spec §8: the command run, its verbatim output, and the value chosen as a result. Anything you could not observe gets the words "not verified" and no number.

- [ ] **Step 8: Commit**

```bash
git add tests/fixtures/steam docs/superpowers/specs/2026-08-30-m3-observations.md
git commit -m "Capture live Steam fixtures and rate-limit observations for M3"
```

---

## Task 2: Catalogue columns for queue ordering

**Files:**
- Modify: `db/schema.ts` (the `steamApp` table)
- Create: `db/migrations/<generated>.sql` (via `pnpm db:generate`)
- Modify: `server/steam/app-list.ts`
- Modify: `server/catalogue/sync.ts`
- Modify: `tests/steam/app-list.test.ts`
- Modify: `tests/db-integration/catalogue-upsert.test.ts`
- Modify: `tests/fixtures/steam/app-list-page.json`

**Interfaces:**
- Consumes: nothing.
- Produces: `steamApp.steamLastModified` (`timestamptz`, nullable) and `steamApp.priceChangeNumber` (`integer`, nullable) on the `steam_app` table; `SteamAppListEntry` gains `priceChangeNumber?: number`. Task 7 orders the queue by `steam_last_modified`.

- [ ] **Step 1: Write the failing parser test**

Add to `tests/steam/app-list.test.ts`, inside the existing `describe('parseAppListPage')`:

```ts
it('carries price_change_number through', () => {
  const page = parseAppListPage({
    response: {
      apps: [{ appid: 10, name: 'Counter-Strike', last_modified: 1745368572, price_change_number: 4321 }],
      have_more_results: false,
    },
  })
  expect(page.apps[0]).toEqual({
    appid: 10,
    name: 'Counter-Strike',
    lastModified: 1745368572,
    priceChangeNumber: 4321,
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm test -- tests/steam/app-list.test.ts`
Expected: FAIL — the received object has no `priceChangeNumber` key.

- [ ] **Step 3: Carry the field through the parser**

In `server/steam/app-list.ts`, add to `entrySchema`:

```ts
price_change_number: z.number().int().optional(),
```

Extend the exported type:

```ts
export type SteamAppListEntry = {
  appid: number
  name: string
  lastModified?: number
  priceChangeNumber?: number
}
```

And the mapping inside `parseAppListPage`:

```ts
apps: response.apps.map((a) => ({
  appid: a.appid,
  name: a.name,
  lastModified: a.last_modified,
  priceChangeNumber: a.price_change_number,
})),
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `pnpm test -- tests/steam/app-list.test.ts`
Expected: PASS. The existing `parses a full page` test also still passes, because `toEqual` treats an absent optional key and an `undefined` value as equal.

- [ ] **Step 5: Add the columns to the schema**

In `db/schema.ts`, inside the `steamApp` table definition, after `lastSeenInListAt`:

```ts
steamLastModified: timestamp('steam_last_modified', { withTimezone: true }),
priceChangeNumber: integer('price_change_number'),
```

Replace the table's index array with:

```ts
(t) => [
  index('steam_app_queue_idx').on(
    t.hydrationState,
    t.nextAttemptAt,
    t.appType,
    desc(t.steamLastModified),
  ),
],
```

Add `desc` to the import from `drizzle-orm` (it lives in the root package, not `drizzle-orm/pg-core`):

```ts
import { desc } from 'drizzle-orm'
```

- [ ] **Step 6: Generate and apply the migration**

```bash
pnpm db:generate
pnpm db:migrate
```

Paste both outputs into your report. Then confirm the columns exist rather than assuming the migration did what it said:

```bash
node -e "
process.loadEnvFile('.env.local');
const {Pool}=require('pg');
const p=new Pool({connectionString:process.env.DATABASE_URL});
p.query(\"select column_name, data_type from information_schema.columns where table_name='steam_app' order by ordinal_position\")
  .then(r=>{console.table(r.rows); return p.end()});
"
```

- [ ] **Step 7: Write the failing upsert test**

Add to `tests/db-integration/catalogue-upsert.test.ts`:

```ts
it('writes steam_last_modified and price_change_number', async () => {
  const db = getDb()
  await upsertAppBatch(
    db,
    [{ appid: APPID, name: 'Fixture One', lastModified: 1745368572, priceChangeNumber: 4321 }],
    'game',
    new Date('2026-01-01'),
  )

  const { rows } = await db.execute<{ steam_last_modified: string; price_change_number: number }>(
    sql`select steam_last_modified, price_change_number from steam_app where appid = ${APPID}`,
  )

  expect(new Date(rows[0]!.steam_last_modified).getTime()).toBe(1745368572 * 1000)
  expect(rows[0]!.price_change_number).toBe(4321)
})
```

- [ ] **Step 8: Run it and watch it fail**

Run: `pnpm test:db -- tests/db-integration/catalogue-upsert.test.ts`
Expected: FAIL — both columns are null.

- [ ] **Step 9: Write the columns in the upsert**

In `server/catalogue/sync.ts`, in `upsertAppBatch`, extend the values mapping and the conflict set:

```ts
.values(
  rows.map((r) => ({
    appid: r.appid,
    name: r.name,
    appType,
    lastSeenInListAt: seenAt,
    steamLastModified: r.lastModified === undefined ? null : new Date(r.lastModified * 1000),
    priceChangeNumber: r.priceChangeNumber ?? null,
  })),
)
.onConflictDoUpdate({
  target: steamApp.appid,
  // hydration_state, failure_count and next_attempt_at belong to the hydration queue.
  // Writing them here would re-queue the whole catalogue on every sync.
  set: {
    name: sql`excluded.name`,
    appType: sql`excluded.app_type`,
    lastSeenInListAt: sql`excluded.last_seen_in_list_at`,
    steamLastModified: sql`excluded.steam_last_modified`,
    priceChangeNumber: sql`excluded.price_change_number`,
  },
})
```

`last_modified` is Unix seconds; the column is `timestamptz`. Multiplying by 1000 is the whole conversion, and getting it wrong silently reorders the entire hydration queue.

- [ ] **Step 10: Run the database tests and watch them pass**

Run: `pnpm test:db`
Expected: PASS, including the existing test asserting the queue columns are still never overwritten.

- [ ] **Step 11: Backfill the two columns for the existing 245,000 rows**

```bash
pnpm sync:catalogue
```

Then confirm the backfill landed:

```bash
node -e "
process.loadEnvFile('.env.local');
const {Pool}=require('pg');
const p=new Pool({connectionString:process.env.DATABASE_URL});
p.query('select count(*)::int total, count(steam_last_modified)::int with_modified, count(price_change_number)::int with_pcn from steam_app')
  .then(r=>{console.log(r.rows[0]); return p.end()});
"
```

Report the numbers. If `with_modified` is far below `total`, Steam did not send `last_modified` for those apps — record that; the queue ordering puts nulls last for exactly this reason.

- [ ] **Step 12: Verify and commit**

```bash
pnpm lint && pnpm typecheck && pnpm test
git add db/schema.ts db/migrations server/steam/app-list.ts server/catalogue/sync.ts tests/
git commit -m "Store last_modified and price_change_number for hydration queue ordering"
```

---

## Task 3: The rate limiter

**Files:**
- Create: `server/steam/limiter.ts`
- Modify: `server/steam/client.ts`
- Modify: `server/env.ts`
- Create: `tests/steam/limiter.test.ts`
- Modify: `tests/steam/client.test.ts`
- Modify: `tests/env.test.ts`

**Interfaces:**
- Consumes: the measured rate from Task 1.
- Produces: `createLimiter(ratePerSecond: number): { acquire(): Promise<void> }` and `limiterForHost(hostname: string): Limiter`. `steamFetchJson(url: URL, opts?: { retries?: number; backoffMs?: number; timeoutMs?: number })` keeps its signature and gains `timeoutMs`. Every later task calls `steamFetchJson` and gets limiting for free.

- [ ] **Step 1: Write the failing limiter test**

```ts
// tests/steam/limiter.test.ts
import { describe, expect, it } from 'vitest'
import { createLimiter } from '@/server/steam/limiter'

describe('createLimiter', () => {
  it('spaces acquisitions by the configured interval', async () => {
    const limiter = createLimiter(50) // 50/s => 20ms apart
    const started = Date.now()
    await limiter.acquire()
    await limiter.acquire()
    await limiter.acquire()
    const elapsed = Date.now() - started

    // Three acquisitions means two gaps. Timers fire late, never early, so assert the floor.
    expect(elapsed).toBeGreaterThanOrEqual(35)
  })

  it('does not delay the first acquisition', async () => {
    const limiter = createLimiter(2)
    const started = Date.now()
    await limiter.acquire()
    expect(Date.now() - started).toBeLessThan(50)
  })

  it('serialises concurrent callers instead of letting them share a slot', async () => {
    const limiter = createLimiter(100) // 10ms apart
    const order: number[] = []
    const started = Date.now()
    await Promise.all(
      [0, 1, 2, 3].map(async (i) => {
        await limiter.acquire()
        order.push(i)
      }),
    )
    expect(order).toEqual([0, 1, 2, 3])
    expect(Date.now() - started).toBeGreaterThanOrEqual(25)
  })

  it('rejects a non-positive rate', () => {
    expect(() => createLimiter(0)).toThrow(RangeError)
    expect(() => createLimiter(-1)).toThrow(RangeError)
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm test -- tests/steam/limiter.test.ts`
Expected: FAIL — cannot resolve `@/server/steam/limiter`.

- [ ] **Step 3: Implement the limiter**

```ts
// server/steam/limiter.ts
import 'server-only'

export type Limiter = { acquire: () => Promise<void> }

export function createLimiter(ratePerSecond: number): Limiter {
  if (!(ratePerSecond > 0)) {
    throw new RangeError(`ratePerSecond must be positive, got ${ratePerSecond}`)
  }
  const intervalMs = 1000 / ratePerSecond
  let nextSlot = 0

  return {
    async acquire() {
      const now = Date.now()
      // Reserving the slot before awaiting is what serialises concurrent callers: two
      // acquire() calls in the same tick take consecutive slots rather than the same one.
      const slot = Math.max(now, nextSlot)
      nextSlot = slot + intervalMs
      const waitMs = slot - now
      if (waitMs > 0) await new Promise((r) => setTimeout(r, waitMs))
    },
  }
}

// api.steampowered.com and store.steampowered.com are different hosts with different
// behaviour: the M2 sync moves 245k appids through the former in 18 seconds, while the
// latter is the constrained one. A single global limiter would slow the sync to
// storefront speed for no reason.
const STOREFRONT_HOST = 'store.steampowered.com'
const WEB_API_RATE = 5

const limiters = new Map<string, Limiter>()

export function limiterForHost(hostname: string): Limiter {
  const existing = limiters.get(hostname)
  if (existing) return existing

  const rate = hostname === STOREFRONT_HOST ? storefrontRate() : WEB_API_RATE
  const created = createLimiter(rate)
  limiters.set(hostname, created)
  return created
}

function storefrontRate(): number {
  const raw = process.env.STEAM_STOREFRONT_RPS
  if (raw === undefined) return DEFAULT_STOREFRONT_RPS
  const parsed = Number(raw)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new RangeError(`STEAM_STOREFRONT_RPS must be a positive number, got: ${raw}`)
  }
  return parsed
}

// Replace this with the rate measured in Task 1 (see the M3 observations doc) and delete
// this comment. Until that measurement exists this is the widely repeated "200 per 5
// minutes" figure, which this project has never verified.
export const DEFAULT_STOREFRONT_RPS = 0.67
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `pnpm test -- tests/steam/limiter.test.ts`
Expected: PASS, four tests.

- [ ] **Step 5: Write the failing client test**

Add to `tests/steam/client.test.ts`:

```ts
it('waits for the limiter before each storefront request', async () => {
  const timestamps: number[] = []
  vi.stubEnv('STEAM_STOREFRONT_RPS', '50')
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      timestamps.push(Date.now())
      return new Response('{"ok":true}', { status: 200 })
    }),
  )

  const url = new URL('https://store.steampowered.com/api/appdetails?appids=620')
  await steamFetchJson(url)
  await steamFetchJson(url)

  expect(timestamps).toHaveLength(2)
  expect(timestamps[1]! - timestamps[0]!).toBeGreaterThanOrEqual(15)
})

it('aborts a request that exceeds the timeout', async () => {
  vi.stubEnv('STEAM_STOREFRONT_RPS', '100')
  vi.stubGlobal(
    'fetch',
    vi.fn((_url: URL, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))
      }),
    ),
  )

  await expect(
    steamFetchJson(new URL('https://store.steampowered.com/api/appdetails?appids=620'), {
      retries: 0,
      timeoutMs: 30,
    }),
  ).rejects.toThrow()
})
```

Add `vi.unstubAllEnvs()` to the file's existing `afterEach`, and make sure `limiterForHost`'s cache does not leak between tests by exporting a reset used only by tests:

```ts
// server/steam/limiter.ts
export function resetLimitersForTest(): void {
  limiters.clear()
}
```

Call it in the test file's `afterEach`. A module-level cache that survives a `vi.stubEnv` change would make the rate test pass or fail depending on file order.

- [ ] **Step 6: Run it and watch it fail**

Run: `pnpm test -- tests/steam/client.test.ts`
Expected: FAIL — requests are not spaced, and `timeoutMs` is not a recognised option.

- [ ] **Step 7: Wire the limiter and timeout into the client**

In `server/steam/client.ts`:

```ts
import { limiterForHost } from './limiter.ts'

type FetchOptions = { retries?: number; backoffMs?: number; timeoutMs?: number }

const DEFAULT_TIMEOUT_MS = 20_000
```

Inside the retry loop, replace the bare `res = await fetch(url)` with:

```ts
await limiterForHost(url.hostname).acquire()
res = await fetch(url, { signal: AbortSignal.timeout(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS) })
```

The existing `catch` already treats a thrown fetch as a retryable network fault, which is what a timeout should be, so no other change is needed there.

- [ ] **Step 8: Run the tests and watch them pass**

Run: `pnpm test -- tests/steam/client.test.ts tests/steam/limiter.test.ts`
Expected: PASS.

- [ ] **Step 9: Add the environment variables**

In `server/env.ts`, extend the schema and the returned object:

```ts
const schema = z.object({
  DATABASE_URL: z.string({ error: 'DATABASE_URL is not set' }).min(1, 'DATABASE_URL is not set'),
  STEAM_COUNTRY_CODE: z.string().default('cz'),
  STEAM_LANGUAGE: z.string().default('english'),
})
```

```ts
return {
  databaseUrl: parsed.DATABASE_URL,
  steamCountryCode: parsed.STEAM_COUNTRY_CODE,
  steamLanguage: parsed.STEAM_LANGUAGE,
}
```

`STEAM_STOREFRONT_RPS` is deliberately read inside the limiter rather than here: `parseServerEnv` runs in request paths that have no business failing because a job's tuning variable is malformed.

Add to `tests/env.test.ts`:

```ts
it('defaults the language to english', () => {
  expect(parseServerEnv({ DATABASE_URL: 'postgres://x' }).steamLanguage).toBe('english')
})
```

- [ ] **Step 10: Verify and commit**

```bash
pnpm lint && pnpm typecheck && pnpm test
git add server/steam/limiter.ts server/steam/client.ts server/env.ts tests/
git commit -m "Add the per-host Steam limiter and a request timeout"
```

---

## Task 4: Payload parsers

**Files:**
- Create: `server/steam/schemas.ts`
- Create: `tests/steam/schemas.test.ts`

**Interfaces:**
- Consumes: the fixtures from Task 1.
- Produces:
  - `type AppDetails` — the parsed `data` object
  - `parseAppDetails(raw: unknown, appid: number): { kind: 'ok'; data: AppDetails } | { kind: 'unavailable' }`
  - `type PriceOverview = { currency: string; initialMinor: number; finalMinor: number; discountPercent: number }`
  - `parsePriceOverviewBatch(raw: unknown): Map<number, PriceOverview | null>`
  - `type ReviewSummary` and `parseReviewSummary(raw: unknown)`
  - `SteamParseError` (extends `Error`, carries `appid: number | undefined` and `issues: string`)

**Write the parsers against the fixtures you captured, not against the field list below.** The list reflects what `db/schema.ts` declares; if a fixture shows a different shape, the fixture wins and you note the difference in your report.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/steam/schemas.test.ts
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  parseAppDetails,
  parsePriceOverviewBatch,
  parseReviewSummary,
  SteamParseError,
} from '@/server/steam/schemas'

const fixture = (name: string) =>
  JSON.parse(readFileSync(path.join(import.meta.dirname, '../fixtures/steam', name), 'utf8'))

describe('parseAppDetails', () => {
  it('parses a priced game', () => {
    const result = parseAppDetails(fixture('appdetails-620.json'), 620)
    expect(result.kind).toBe('ok')
    if (result.kind !== 'ok') return
    expect(result.data.steam_appid).toBe(620)
    expect(result.data.type).toBe('game')
    expect(result.data.name).toBeTruthy()
    expect(result.data.price_overview?.currency).toBe('EUR')
    expect(result.data.price_overview?.final).toBeGreaterThan(0)
  })

  it('parses a free game as ok with no price', () => {
    const result = parseAppDetails(fixture('appdetails-570.json'), 570)
    expect(result.kind).toBe('ok')
    if (result.kind !== 'ok') return
    expect(result.data.is_free).toBe(true)
    expect(result.data.price_overview).toBeUndefined()
  })

  it('reports an unknown appid as unavailable rather than throwing', () => {
    expect(parseAppDetails(fixture('appdetails-missing.json'), 999999999)).toEqual({
      kind: 'unavailable',
    })
  })

  it('reports a non-game type without special-casing it', () => {
    const result = parseAppDetails(fixture('appdetails-323180.json'), 323180)
    expect(result.kind).toBe('ok')
    if (result.kind !== 'ok') return
    expect(result.data.type).not.toBe('game')
  })

  it('treats a payload keyed by a different appid as unavailable', () => {
    expect(parseAppDetails(fixture('appdetails-620.json'), 570)).toEqual({ kind: 'unavailable' })
  })

  it('throws a SteamParseError naming the field when the shape changes', () => {
    const broken = { '620': { success: true, data: { steam_appid: '620', type: 'game', name: 'x' } } }
    try {
      parseAppDetails(broken, 620)
      throw new Error('expected parseAppDetails to throw')
    } catch (err) {
      expect(err).toBeInstanceOf(SteamParseError)
      expect((err as SteamParseError).appid).toBe(620)
      expect((err as SteamParseError).message).toContain('steam_appid')
    }
  })
})

describe('parsePriceOverviewBatch', () => {
  it('parses every returned appid', () => {
    const prices = parsePriceOverviewBatch(fixture('price-overview-batch.json'))
    expect(prices.size).toBeGreaterThan(0)
    for (const [appid, price] of prices) {
      expect(Number.isInteger(appid)).toBe(true)
      if (price) {
        expect(Number.isInteger(price.finalMinor)).toBe(true)
        expect(price.currency).toMatch(/^[A-Z]{3}$/)
      }
    }
  })

  it('maps a free game with an empty data array to null', () => {
    const prices = parsePriceOverviewBatch({ '570': { success: true, data: [] } })
    expect(prices.get(570)).toBeNull()
  })

  it('maps an unsuccessful entry to null', () => {
    const prices = parsePriceOverviewBatch({ '999999999': { success: false } })
    expect(prices.get(999999999)).toBeNull()
  })
})

describe('parseReviewSummary', () => {
  it('parses the aggregate and nothing else', () => {
    const summary = parseReviewSummary(fixture('appreviews-620.json'))
    expect(summary.totalReviews).toBeGreaterThan(0)
    expect(summary.totalPositive + summary.totalNegative).toBe(summary.totalReviews)
    expect(summary.reviewScoreDesc).toBeTruthy()
    expect(Object.keys(summary).sort()).toEqual(
      ['reviewScore', 'reviewScoreDesc', 'totalNegative', 'totalPositive', 'totalReviews'].sort(),
    )
  })
})
```

The last assertion is the review-policy guard: it fails if anyone ever widens the parser to carry review bodies or author fields into the app.

- [ ] **Step 2: Run and watch them fail**

Run: `pnpm test -- tests/steam/schemas.test.ts`
Expected: FAIL — cannot resolve `@/server/steam/schemas`.

- [ ] **Step 3: Implement the parsers**

```ts
// server/steam/schemas.ts
import 'server-only'
import { z } from 'zod'

export class SteamParseError extends Error {
  readonly appid: number | undefined
  readonly issues: string

  constructor(message: string, appid: number | undefined, issues: string) {
    super(message)
    this.name = 'SteamParseError'
    this.appid = appid
    this.issues = issues
  }
}

const priceOverviewSchema = z.object({
  currency: z.string(),
  initial: z.number().int(),
  final: z.number().int(),
  discount_percent: z.number().int().default(0),
})

const mediaEntrySchema = z.object({
  id: z.number().int().optional(),
  name: z.string().optional(),
  thumbnail: z.string().optional(),
  highlight: z.boolean().optional(),
  path_thumbnail: z.string().optional(),
  path_full: z.string().optional(),
  mp4: z.record(z.string(), z.string()).optional(),
  webm: z.record(z.string(), z.string()).optional(),
  hls_h264: z.record(z.string(), z.string()).optional(),
  dash_h264: z.record(z.string(), z.string()).optional(),
  dash_av1: z.record(z.string(), z.string()).optional(),
})

const appDetailsDataSchema = z.object({
  steam_appid: z.number().int(),
  type: z.string(),
  name: z.string(),
  is_free: z.boolean().default(false),
  short_description: z.string().optional(),
  about_the_game: z.string().optional(),
  detailed_description: z.string().optional(),
  header_image: z.string().optional(),
  capsule_image: z.string().optional(),
  background_raw: z.string().optional(),
  release_date: z.object({ coming_soon: z.boolean().default(false), date: z.string().default('') }).optional(),
  developers: z.array(z.string()).optional(),
  publishers: z.array(z.string()).optional(),
  platforms: z.object({ windows: z.boolean(), mac: z.boolean(), linux: z.boolean() }).optional(),
  metacritic: z.object({ score: z.number().int(), url: z.string() }).optional(),
  recommendations: z.object({ total: z.number().int() }).optional(),
  achievements: z.object({ total: z.number().int() }).optional(),
  supported_languages: z.string().optional(),
  content_descriptors: z
    .object({ ids: z.array(z.number().int()).default([]), notes: z.string().nullable().optional() })
    .optional(),
  dlc: z.array(z.number().int()).optional(),
  price_overview: priceOverviewSchema.optional(),
  genres: z.array(z.object({ id: z.string(), description: z.string() })).optional(),
  categories: z.array(z.object({ id: z.number().int(), description: z.string() })).optional(),
  screenshots: z.array(mediaEntrySchema).optional(),
  movies: z.array(mediaEntrySchema).optional(),
  // Observed as both an object with minimum/recommended HTML and an empty array, so it is
  // stored as-is in a jsonb column rather than given a shape it does not always have.
  pc_requirements: z.unknown().optional(),
  mac_requirements: z.unknown().optional(),
  linux_requirements: z.unknown().optional(),
})

export type AppDetails = z.infer<typeof appDetailsDataSchema>

const envelopeSchema = z.record(
  z.string(),
  z.object({ success: z.boolean(), data: z.unknown().optional() }),
)

export type AppDetailsResult = { kind: 'ok'; data: AppDetails } | { kind: 'unavailable' }

export function parseAppDetails(raw: unknown, appid: number): AppDetailsResult {
  const envelope = envelopeSchema.safeParse(raw)
  if (!envelope.success) {
    throw new SteamParseError(
      `appdetails envelope did not parse for appid ${appid}`,
      appid,
      z.prettifyError(envelope.error),
    )
  }

  const entry = envelope.data[String(appid)]
  // A payload keyed by a different appid is not ours to write: appdetails redirects some
  // appids to their base game, and writing that payload under the requested appid would
  // silently duplicate one game across two rows.
  if (!entry || !entry.success || entry.data === undefined) return { kind: 'unavailable' }

  const parsed = appDetailsDataSchema.safeParse(entry.data)
  if (!parsed.success) {
    throw new SteamParseError(
      `appdetails data did not parse for appid ${appid}: ${z.prettifyError(parsed.error)}`,
      appid,
      z.prettifyError(parsed.error),
    )
  }
  if (parsed.data.steam_appid !== appid) return { kind: 'unavailable' }

  return { kind: 'ok', data: parsed.data }
}

export type PriceOverview = {
  currency: string
  initialMinor: number
  finalMinor: number
  discountPercent: number
}

export function parsePriceOverviewBatch(raw: unknown): Map<number, PriceOverview | null> {
  const envelope = envelopeSchema.safeParse(raw)
  if (!envelope.success) {
    throw new SteamParseError(
      'price_overview batch envelope did not parse',
      undefined,
      z.prettifyError(envelope.error),
    )
  }

  const out = new Map<number, PriceOverview | null>()
  for (const [key, entry] of Object.entries(envelope.data)) {
    const appid = Number(key)
    if (!Number.isInteger(appid)) continue

    // Free games return "data": [] — an empty array, not an object.
    if (!entry.success || entry.data === undefined || Array.isArray(entry.data)) {
      out.set(appid, null)
      continue
    }

    const parsed = z.object({ price_overview: priceOverviewSchema.optional() }).safeParse(entry.data)
    if (!parsed.success) {
      throw new SteamParseError(
        `price_overview did not parse for appid ${appid}`,
        appid,
        z.prettifyError(parsed.error),
      )
    }

    const p = parsed.data.price_overview
    out.set(
      appid,
      p
        ? {
            currency: p.currency,
            initialMinor: p.initial,
            finalMinor: p.final,
            discountPercent: p.discount_percent,
          }
        : null,
    )
  }
  return out
}

const reviewSummarySchema = z.object({
  query_summary: z.object({
    review_score: z.number().int().optional(),
    review_score_desc: z.string().optional(),
    total_positive: z.number().int().default(0),
    total_negative: z.number().int().default(0),
    total_reviews: z.number().int().default(0),
  }),
})

export type ReviewSummary = {
  reviewScore: number | undefined
  reviewScoreDesc: string | undefined
  totalPositive: number
  totalNegative: number
  totalReviews: number
}

// Only the aggregate crosses this boundary. Review bodies and author identifiers are never
// fetched (num_per_page=0) and must never be added to this return type.
export function parseReviewSummary(raw: unknown): ReviewSummary {
  const parsed = reviewSummarySchema.safeParse(raw)
  if (!parsed.success) {
    throw new SteamParseError(
      'appreviews query_summary did not parse',
      undefined,
      z.prettifyError(parsed.error),
    )
  }
  const s = parsed.data.query_summary
  return {
    reviewScore: s.review_score,
    reviewScoreDesc: s.review_score_desc,
    totalPositive: s.total_positive,
    totalNegative: s.total_negative,
    totalReviews: s.total_reviews,
  }
}
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `pnpm test -- tests/steam/schemas.test.ts`
Expected: PASS.

If a fixture fails to parse, **the fixture is right and the schema is wrong** — fix the schema, and record the difference between what you expected and what Steam sent in your report. That difference is the most valuable output of this task.

- [ ] **Step 5: Verify and commit**

```bash
pnpm lint && pnpm typecheck && pnpm test
git add server/steam/schemas.ts tests/steam/schemas.test.ts
git commit -m "Add Zod parsers for appdetails, price_overview and appreviews"
```

---

## Task 5: TTL and the read-through cache

**Files:**
- Create: `server/steam/ttl.ts`
- Create: `server/steam/cache.ts`
- Create: `tests/steam/ttl.test.ts`
- Create: `tests/steam/cache.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `TTL_MS` (`{ price, reviewSummary, gameDetail, unreleasedGameDetail }`), `isFresh(fetchedAt: Date | null | undefined, ttlMs: number, now?: number): boolean`, and `readThrough<T>(opts: { load: () => Promise<{ value: T; fetchedAt: Date } | undefined>; ttlMs: number; refresh: () => Promise<T>; label: string }): Promise<T>`.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/steam/ttl.test.ts
import { describe, expect, it } from 'vitest'
import { isFresh, TTL_MS } from '@/server/steam/ttl'

describe('isFresh', () => {
  const now = new Date('2026-08-30T12:00:00Z').getTime()

  it('is fresh inside the window', () => {
    expect(isFresh(new Date(now - 60_000), TTL_MS.price, now)).toBe(true)
  })

  it('is stale outside the window', () => {
    expect(isFresh(new Date(now - TTL_MS.price - 1), TTL_MS.price, now)).toBe(false)
  })

  it('treats a missing timestamp as stale', () => {
    expect(isFresh(null, TTL_MS.price, now)).toBe(false)
    expect(isFresh(undefined, TTL_MS.price, now)).toBe(false)
  })

  it('treats a future timestamp as fresh rather than as an error', () => {
    expect(isFresh(new Date(now + 5_000), TTL_MS.price, now)).toBe(true)
  })

  it('orders the windows by volatility', () => {
    expect(TTL_MS.price).toBeLessThan(TTL_MS.reviewSummary)
    expect(TTL_MS.reviewSummary).toBeLessThanOrEqual(TTL_MS.unreleasedGameDetail)
    expect(TTL_MS.unreleasedGameDetail).toBeLessThan(TTL_MS.gameDetail)
  })
})
```

```ts
// tests/steam/cache.test.ts
import { describe, expect, it, vi } from 'vitest'
import { readThrough } from '@/server/steam/cache'

describe('readThrough', () => {
  it('returns the cached value without refreshing when fresh', async () => {
    const refresh = vi.fn(async () => 'fresh')
    const value = await readThrough({
      load: async () => ({ value: 'cached', fetchedAt: new Date() }),
      ttlMs: 60_000,
      refresh,
      label: 'test',
    })
    expect(value).toBe('cached')
    expect(refresh).not.toHaveBeenCalled()
  })

  it('refreshes when the cached value is stale', async () => {
    const value = await readThrough({
      load: async () => ({ value: 'cached', fetchedAt: new Date(Date.now() - 120_000) }),
      ttlMs: 60_000,
      refresh: async () => 'fresh',
      label: 'test',
    })
    expect(value).toBe('fresh')
  })

  it('serves the stale value when the refresh fails', async () => {
    const errors: unknown[] = []
    vi.spyOn(console, 'error').mockImplementation((...args) => errors.push(args))

    const value = await readThrough({
      load: async () => ({ value: 'cached', fetchedAt: new Date(Date.now() - 120_000) }),
      ttlMs: 60_000,
      refresh: async () => {
        throw new Error('steam is down')
      },
      label: 'appdetails 620',
    })

    expect(value).toBe('cached')
    expect(errors).toHaveLength(1)
    vi.restoreAllMocks()
  })

  it('propagates the failure when there is nothing cached', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(
      readThrough({
        load: async () => undefined,
        ttlMs: 60_000,
        refresh: async () => {
          throw new Error('steam is down')
        },
        label: 'appdetails 620',
      }),
    ).rejects.toThrow('steam is down')
    vi.restoreAllMocks()
  })
})
```

- [ ] **Step 2: Run and watch them fail**

Run: `pnpm test -- tests/steam/ttl.test.ts tests/steam/cache.test.ts`
Expected: FAIL — neither module resolves.

- [ ] **Step 3: Implement both modules**

```ts
// server/steam/ttl.ts
import 'server-only'

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

// Every freshness window lives here. Scattering them through call sites is how a price ends
// up cached for a month.
export const TTL_MS = {
  price: 6 * HOUR,
  reviewSummary: 1 * DAY,
  unreleasedGameDetail: 1 * DAY,
  gameDetail: 30 * DAY,
} as const

export function isFresh(
  fetchedAt: Date | null | undefined,
  ttlMs: number,
  now: number = Date.now(),
): boolean {
  if (!fetchedAt) return false
  return now - fetchedAt.getTime() < ttlMs
}
```

```ts
// server/steam/cache.ts
import 'server-only'
import { isFresh } from './ttl.ts'

export type ReadThroughOptions<T> = {
  load: () => Promise<{ value: T; fetchedAt: Date } | undefined>
  ttlMs: number
  refresh: () => Promise<T>
  label: string
}

export async function readThrough<T>({ load, ttlMs, refresh, label }: ReadThroughOptions<T>): Promise<T> {
  const cached = await load()
  if (cached && isFresh(cached.fetchedAt, ttlMs)) return cached.value

  try {
    return await refresh()
  } catch (err) {
    // A stale price is better than a broken page. Only a miss with nothing cached at all
    // reaches the caller as a failure.
    console.error(`steam refresh failed for ${label}; serving stale:`, err)
    if (cached) return cached.value
    throw err
  }
}
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `pnpm test -- tests/steam/ttl.test.ts tests/steam/cache.test.ts`
Expected: PASS, nine tests.

- [ ] **Step 5: Verify and commit**

```bash
pnpm lint && pnpm typecheck && pnpm test
git add server/steam/ttl.ts server/steam/cache.ts tests/steam/ttl.test.ts tests/steam/cache.test.ts
git commit -m "Add the TTL table and the read-through cache helper"
```

---

## Task 6: Mapping payloads to rows

**Files:**
- Create: `server/catalogue/map-app-details.ts`
- Create: `tests/catalogue/map-app-details.test.ts`
- Modify: `package.json` (add `isomorphic-dompurify`)

**Interfaces:**
- Consumes: `AppDetails` and `PriceOverview` from Task 4.
- Produces:
  - `mapGameRow(data: AppDetails, fetchedAt: Date): typeof game.$inferInsert`
  - `mapMediaRows(data: AppDetails): Omit<typeof gameMedia.$inferInsert, 'id'>[]`
  - `mapPriceRow(data: AppDetails, cc: string, fetchedAt: Date): typeof price.$inferInsert | null`
  - `parseReleaseDate(text: string): Date | null`

- [ ] **Step 1: Install the sanitiser**

```bash
pnpm add isomorphic-dompurify
```

It is on the approved list in `CLAUDE.md`. Do not add anything else.

- [ ] **Step 2: Write the failing tests**

```ts
// tests/catalogue/map-app-details.test.ts
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { mapGameRow, mapMediaRows, mapPriceRow, parseReleaseDate } from '@/server/catalogue/map-app-details'
import { parseAppDetails } from '@/server/steam/schemas'

const details = (name: string, appid: number) => {
  const raw = JSON.parse(readFileSync(path.join(import.meta.dirname, '../fixtures/steam', name), 'utf8'))
  const result = parseAppDetails(raw, appid)
  if (result.kind !== 'ok') throw new Error(`fixture ${name} did not parse as ok`)
  return result.data
}

const FETCHED = new Date('2026-08-30T12:00:00Z')

describe('mapGameRow', () => {
  it('maps the identity and flags', () => {
    const row = mapGameRow(details('appdetails-620.json', 620), FETCHED)
    expect(row.appid).toBe(620)
    expect(row.type).toBe('game')
    expect(row.name).toBeTruthy()
    expect(row.fetchedAt).toBe(FETCHED)
  })

  it('sanitises the description HTML', () => {
    const data = details('appdetails-620.json', 620)
    const row = mapGameRow(
      { ...data, about_the_game: '<p>Safe</p><script>alert(1)</script><img src=x onerror=alert(1)>' },
      FETCHED,
    )
    expect(row.aboutHtml).toContain('Safe')
    expect(row.aboutHtml).not.toContain('<script')
    expect(row.aboutHtml).not.toContain('onerror')
  })

  it('keeps the release date text and parses what it can', () => {
    const row = mapGameRow(
      { ...details('appdetails-620.json', 620), release_date: { coming_soon: false, date: '10 Oct, 2007' } },
      FETCHED,
    )
    expect(row.releaseDateText).toBe('10 Oct, 2007')
    expect(row.releaseComingSoon).toBe(false)
    expect(row.releaseDate?.getUTCFullYear()).toBe(2007)
  })

  it('stores null rather than a guess for an unparseable release date', () => {
    const row = mapGameRow(
      { ...details('appdetails-620.json', 620), release_date: { coming_soon: true, date: 'Q4 2026' } },
      FETCHED,
    )
    expect(row.releaseDateText).toBe('Q4 2026')
    expect(row.releaseComingSoon).toBe(true)
    expect(row.releaseDate).toBeNull()
  })
})

describe('mapMediaRows', () => {
  it('reads media URLs from the payload and never constructs them', () => {
    const rows = mapMediaRows(details('appdetails-1174180.json', 1174180))
    expect(rows.length).toBeGreaterThan(0)
    for (const row of rows) {
      expect(['screenshot', 'movie']).toContain(row.kind)
      expect(row.appid).toBe(1174180)
    }
    const movies = rows.filter((r) => r.kind === 'movie')
    if (movies.length > 0) {
      expect(movies[0]!.hlsUrl ?? movies[0]!.dashH264Url).toBeTruthy()
    }
    expect(rows.filter((r) => r.kind === 'screenshot').map((r) => r.position)).toEqual(
      rows.filter((r) => r.kind === 'screenshot').map((_, i) => i),
    )
  })

  it('returns an empty list when there is no media', () => {
    const data = details('appdetails-620.json', 620)
    expect(mapMediaRows({ ...data, screenshots: undefined, movies: undefined })).toEqual([])
  })
})

describe('mapPriceRow', () => {
  it('reads minor units and the currency from the payload', () => {
    const row = mapPriceRow(details('appdetails-620.json', 620), 'cz', FETCHED)
    expect(row).not.toBeNull()
    expect(row!.currency).toBe('EUR')
    expect(row!.cc).toBe('cz')
    expect(Number.isInteger(row!.finalMinor)).toBe(true)
  })

  it('returns null for a free game', () => {
    expect(mapPriceRow(details('appdetails-570.json', 570), 'cz', FETCHED)).toBeNull()
  })
})

describe('parseReleaseDate', () => {
  it.each([
    ['10 Oct, 2007', 2007],
    ['21 Nov, 2024', 2024],
  ])('parses %s', (text, year) => {
    expect(parseReleaseDate(text)?.getUTCFullYear()).toBe(year)
  })

  it.each(['Q4 2026', 'Coming soon', '', 'To be announced'])('returns null for %s', (text) => {
    expect(parseReleaseDate(text)).toBeNull()
  })
})
```

- [ ] **Step 3: Run and watch them fail**

Run: `pnpm test -- tests/catalogue/map-app-details.test.ts`
Expected: FAIL — cannot resolve the mapper module.

- [ ] **Step 4: Implement the mapper**

```ts
// server/catalogue/map-app-details.ts
import 'server-only'
import DOMPurify from 'isomorphic-dompurify'
import type { game, gameMedia, price } from '../../db/schema.ts'
import type { AppDetails } from '../steam/schemas.ts'

const sanitize = (html: string | undefined): string | null =>
  html === undefined ? null : DOMPurify.sanitize(html)

// Steam's release_date.date is store copy, not a date field: "10 Oct, 2007", "Q4 2026",
// "Coming soon". The text is always stored; a parsed date is a bonus, and a wrong one would
// corrupt every release-ordered row, so anything ambiguous becomes null.
export function parseReleaseDate(text: string): Date | null {
  if (!/\d{4}/.test(text)) return null
  const parsed = Date.parse(text)
  if (Number.isNaN(parsed)) return null
  const date = new Date(parsed)
  if (date.getUTCFullYear() < 1990 || date.getUTCFullYear() > 2100) return null
  return date
}

export function mapGameRow(data: AppDetails, fetchedAt: Date): typeof game.$inferInsert {
  const release = data.release_date
  return {
    appid: data.steam_appid,
    name: data.name,
    type: data.type,
    isFree: data.is_free,
    shortDescription: data.short_description ?? null,
    aboutHtml: sanitize(data.about_the_game),
    detailedHtml: sanitize(data.detailed_description),
    headerImage: data.header_image ?? null,
    capsuleImage: data.capsule_image ?? null,
    backgroundRaw: data.background_raw ?? null,
    releaseDateText: release?.date ?? null,
    releaseComingSoon: release?.coming_soon ?? false,
    releaseDate: release?.date ? parseReleaseDate(release.date) : null,
    developers: data.developers ?? null,
    publishers: data.publishers ?? null,
    platforms: data.platforms ?? null,
    metacriticScore: data.metacritic?.score ?? null,
    metacriticUrl: data.metacritic?.url ?? null,
    recommendationsTotal: data.recommendations?.total ?? null,
    achievementsTotal: data.achievements?.total ?? null,
    supportedLanguagesRaw: data.supported_languages ?? null,
    contentDescriptorIds: data.content_descriptors?.ids ?? null,
    contentDescriptorNotes: data.content_descriptors?.notes ?? null,
    dlcAppids: data.dlc ?? null,
    pcRequirements: data.pc_requirements ?? null,
    macRequirements: data.mac_requirements ?? null,
    linuxRequirements: data.linux_requirements ?? null,
    fetchedAt,
  }
}

export function mapMediaRows(data: AppDetails): Omit<typeof gameMedia.$inferInsert, 'id'>[] {
  const rows: Omit<typeof gameMedia.$inferInsert, 'id'>[] = []

  data.screenshots?.forEach((s, position) => {
    rows.push({
      appid: data.steam_appid,
      kind: 'screenshot',
      position,
      steamMediaId: s.id ?? null,
      name: null,
      thumbnailUrl: s.path_thumbnail ?? null,
      fullUrl: s.path_full ?? null,
      hlsUrl: null,
      dashH264Url: null,
      dashAv1Url: null,
      highlight: false,
    })
  })

  // movies[] carries no mp4 or webm — only DASH manifests and an HLS playlist. The URLs are
  // read from the payload; capsule and media paths contain a per-app hash and cannot be
  // constructed from the appid.
  data.movies?.forEach((m, position) => {
    rows.push({
      appid: data.steam_appid,
      kind: 'movie',
      position,
      steamMediaId: m.id ?? null,
      name: m.name ?? null,
      thumbnailUrl: m.thumbnail ?? null,
      fullUrl: null,
      hlsUrl: firstUrl(m.hls_h264),
      dashH264Url: firstUrl(m.dash_h264),
      dashAv1Url: firstUrl(m.dash_av1),
      highlight: m.highlight ?? false,
    })
  })

  return rows
}

const firstUrl = (variants: Record<string, string> | undefined): string | null => {
  if (!variants) return null
  const values = Object.values(variants)
  return values.length > 0 ? values[0]! : null
}

export function mapPriceRow(
  data: AppDetails,
  cc: string,
  fetchedAt: Date,
): typeof price.$inferInsert | null {
  const p = data.price_overview
  if (!p) return null
  return {
    appid: data.steam_appid,
    cc,
    currency: p.currency,
    initialMinor: p.initial,
    finalMinor: p.final,
    discountPercent: p.discount_percent,
    fetchedAt,
  }
}
```

- [ ] **Step 5: Run the tests and watch them pass**

Run: `pnpm test -- tests/catalogue/map-app-details.test.ts`
Expected: PASS.

If the movie-URL assertion fails because your fixture's `movies[]` keys differ from `hls_h264` / `dash_h264` / `dash_av1`, the fixture wins: change `mediaEntrySchema` in Task 4 and this mapper to match, and say so in your report.

- [ ] **Step 6: Verify and commit**

```bash
pnpm lint && pnpm typecheck && pnpm test
git add package.json pnpm-lock.yaml server/catalogue/map-app-details.ts tests/catalogue/map-app-details.test.ts
git commit -m "Map appdetails payloads to rows, sanitising HTML at write time"
```

---

## Task 7: The hydration worker

**Files:**
- Modify: `db/client.ts`
- Create: `server/steam/app-details.ts`
- Create: `server/catalogue/hydrate-write.ts`
- Create: `server/catalogue/queue.ts`
- Create: `server/catalogue/hydrate.ts`
- Create: `server/catalogue/hydrate-cli.mts`
- Create: `tests/catalogue/queue.test.ts`
- Create: `tests/db-integration/hydrate-write.test.ts`
- Create: `tests/db-integration/queue.test.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: `parseAppDetails` (Task 4), `TTL_MS` (Task 5), the mappers (Task 6), the observed advisory-lock result (Task 1).
- Produces:
  - `getJobDb(): NodePgDatabase<typeof schema>` from `db/client.ts`
  - `fetchAppDetails(appid: number, cc: string, l: string): Promise<AppDetailsResult>`
  - `writeHydratedApp(db: JobDb, data: AppDetails, cc: string, now: Date): Promise<void>`
  - `backoffMs(failureCount: number, random?: () => number): number`
  - `selectDueApps(db, opts): Promise<number[]>`, `markOk`, `markUnavailable`, `markFailed`
  - `tryAdvisoryLock(db, key)`, `releaseAdvisoryLock(db, key)`, `HYDRATE_LOCK_KEY = 4801001`
  - `hydrate(opts: { maxRequests?: number; maxDurationMs?: number; appid?: number; type?: 'game' | 'dlc' }): Promise<HydrateCounts>`

- [ ] **Step 1: Add `getJobDb` to the database client**

```ts
// db/client.ts
export type JobDb = NodePgDatabase<typeof schema>

// The shared Db type omits transaction because neon-http has none. Hydration writes game,
// media, genres, categories and price together or not at all, so jobs need the real thing —
// and they only ever run where node-postgres is the driver.
export function getJobDb(): JobDb {
  const driver = resolveDriver(process.env)
  if (driver !== 'node-postgres') {
    throw new Error(`Jobs require the node-postgres driver, got ${driver}`)
  }
  return getDb() as JobDb
}
```

Add a test to `tests/db/client.test.ts`:

```ts
it('refuses to hand a job the non-transactional driver', () => {
  vi.stubEnv('DB_DRIVER', 'neon-http')
  expect(() => getJobDb()).toThrow(/node-postgres/)
  vi.unstubAllEnvs()
})
```

Import `getJobDb` there, run `pnpm test -- tests/db/client.test.ts`, and confirm it passes.

- [ ] **Step 2: Write the failing backoff tests**

```ts
// tests/catalogue/queue.test.ts
import { describe, expect, it } from 'vitest'
import { backoffMs } from '@/server/catalogue/queue'

const FIFTEEN_MIN = 15 * 60_000
const DAY = 24 * 60 * 60_000

describe('backoffMs', () => {
  it('grows exponentially from fifteen minutes', () => {
    expect(backoffMs(1, () => 0.5)).toBe(2 * FIFTEEN_MIN)
    expect(backoffMs(2, () => 0.5)).toBe(4 * FIFTEEN_MIN)
    expect(backoffMs(3, () => 0.5)).toBe(8 * FIFTEEN_MIN)
  })

  it('caps at twenty-four hours', () => {
    expect(backoffMs(20, () => 0.5)).toBe(DAY)
    expect(backoffMs(200, () => 0.5)).toBe(DAY)
  })

  it('applies jitter within twenty percent either way', () => {
    expect(backoffMs(1, () => 0)).toBe(Math.round(2 * FIFTEEN_MIN * 0.8))
    expect(backoffMs(1, () => 1)).toBe(Math.round(2 * FIFTEEN_MIN * 1.2))
  })

  it('rejects a non-positive failure count', () => {
    expect(() => backoffMs(0)).toThrow(RangeError)
  })
})
```

- [ ] **Step 3: Run and watch it fail**

Run: `pnpm test -- tests/catalogue/queue.test.ts`
Expected: FAIL — cannot resolve `@/server/catalogue/queue`.

- [ ] **Step 4: Implement the queue module**

```ts
// server/catalogue/queue.ts
import 'server-only'
import { sql } from 'drizzle-orm'
import type { JobDb } from '../../db/client.ts'

export const HYDRATE_LOCK_KEY = 4801001
export const PRICES_LOCK_KEY = 4801002

const FIFTEEN_MIN = 15 * 60_000
const MAX_BACKOFF_MS = 24 * 60 * 60_000
const UNAVAILABLE_RECHECK_MS = 30 * 24 * 60 * 60_000

export function backoffMs(failureCount: number, random: () => number = Math.random): number {
  if (!Number.isInteger(failureCount) || failureCount < 1) {
    throw new RangeError(`failureCount must be a positive integer, got ${failureCount}`)
  }
  // 2 ** 200 is Infinity, and Math.min handles it, but the exponent is capped anyway so the
  // intermediate value stays a number a reader can reason about.
  const exponent = Math.min(failureCount, 20)
  const base = Math.min(FIFTEEN_MIN * 2 ** exponent, MAX_BACKOFF_MS)
  return Math.round(base * (0.8 + random() * 0.4))
}

export async function tryAdvisoryLock(db: JobDb, key: number): Promise<boolean> {
  const { rows } = await db.execute<{ locked: boolean }>(
    sql`select pg_try_advisory_lock(${key}) as locked`,
  )
  return rows[0]?.locked === true
}

export async function releaseAdvisoryLock(db: JobDb, key: number): Promise<void> {
  await db.execute(sql`select pg_advisory_unlock(${key})`)
}

export async function selectDueApps(
  db: JobDb,
  opts: { limit: number; type?: 'game' | 'dlc' },
): Promise<number[]> {
  const typeFilter = opts.type ? sql`and app_type = ${opts.type}` : sql``
  const { rows } = await db.execute<{ appid: number }>(sql`
    select appid from steam_app
    where hydration_state in ('pending', 'failed')
      and (next_attempt_at is null or next_attempt_at <= now())
      ${typeFilter}
    order by (app_type = 'game') desc, steam_last_modified desc nulls last, appid
    limit ${opts.limit}
  `)
  return rows.map((r) => r.appid)
}

export async function markOk(db: JobDb, appid: number): Promise<void> {
  await db.execute(sql`
    update steam_app
    set hydration_state = 'ok', failure_count = 0, next_attempt_at = null
    where appid = ${appid}
  `)
}

export async function markUnavailable(db: JobDb, appid: number): Promise<void> {
  await db.execute(sql`
    update steam_app
    set hydration_state = 'unavailable',
        failure_count = 0,
        next_attempt_at = now() + ${`${UNAVAILABLE_RECHECK_MS} milliseconds`}::interval
    where appid = ${appid}
  `)
}

export async function markFailed(db: JobDb, appid: number): Promise<void> {
  const { rows } = await db.execute<{ failure_count: number }>(sql`
    update steam_app set failure_count = failure_count + 1, hydration_state = 'failed'
    where appid = ${appid}
    returning failure_count
  `)
  const count = rows[0]?.failure_count ?? 1
  await db.execute(sql`
    update steam_app
    set next_attempt_at = now() + ${`${backoffMs(count)} milliseconds`}::interval
    where appid = ${appid}
  `)
}
```

- [ ] **Step 5: Run the backoff tests and watch them pass**

Run: `pnpm test -- tests/catalogue/queue.test.ts`
Expected: PASS, four tests.

- [ ] **Step 6: Write the failing database-integration tests for the queue**

```ts
// tests/db-integration/queue.test.ts
import { sql } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { getJobDb } from '@/db/client'
import {
  HYDRATE_LOCK_KEY,
  markFailed,
  markOk,
  markUnavailable,
  releaseAdvisoryLock,
  selectDueApps,
  tryAdvisoryLock,
} from '@/server/catalogue/queue'

const BASE = 2147481000
const IDS = [BASE, BASE + 1, BASE + 2, BASE + 3]

const seed = async () => {
  const db = getJobDb()
  await db.execute(sql`delete from steam_app where appid in ${sql.raw(`(${IDS.join(',')})`)}`)
  await db.execute(sql`
    insert into steam_app (appid, name, app_type, hydration_state, steam_last_modified) values
      (${IDS[0]}, 'Old game',   'game', 'pending', '2020-01-01'),
      (${IDS[1]}, 'New game',   'game', 'pending', '2026-08-01'),
      (${IDS[2]}, 'No date',    'game', 'pending', null),
      (${IDS[3]}, 'Recent dlc', 'dlc',  'pending', '2026-08-20')
  `)
}

describe('the hydration queue', () => {
  beforeEach(seed)
  afterAll(async () => {
    await getJobDb().execute(sql`delete from steam_app where appid in ${sql.raw(`(${IDS.join(',')})`)}`)
  })

  it('orders games before DLC and recent before old, with nulls last', async () => {
    const due = await selectDueApps(getJobDb(), { limit: 500 })
    const ours = due.filter((id) => IDS.includes(id))
    expect(ours).toEqual([IDS[1], IDS[0], IDS[2], IDS[3]])
  })

  it('filters by type when asked', async () => {
    const due = await selectDueApps(getJobDb(), { limit: 500, type: 'dlc' })
    expect(due.filter((id) => IDS.includes(id))).toEqual([IDS[3]])
  })

  it('takes a row out of the queue when marked ok', async () => {
    await markOk(getJobDb(), IDS[1]!)
    const due = await selectDueApps(getJobDb(), { limit: 500 })
    expect(due).not.toContain(IDS[1])
  })

  it('schedules a failed row into the future and counts the failure', async () => {
    await markFailed(getJobDb(), IDS[0]!)
    const { rows } = await getJobDb().execute<{ failure_count: number; next_attempt_at: string; hydration_state: string }>(
      sql`select failure_count, next_attempt_at, hydration_state from steam_app where appid = ${IDS[0]}`,
    )
    expect(rows[0]!.failure_count).toBe(1)
    expect(rows[0]!.hydration_state).toBe('failed')
    expect(new Date(rows[0]!.next_attempt_at).getTime()).toBeGreaterThan(Date.now())
    expect(await selectDueApps(getJobDb(), { limit: 500 })).not.toContain(IDS[0])
  })

  it('parks an unavailable row far out but does not lose it', async () => {
    await markUnavailable(getJobDb(), IDS[2]!)
    const { rows } = await getJobDb().execute<{ hydration_state: string; next_attempt_at: string }>(
      sql`select hydration_state, next_attempt_at from steam_app where appid = ${IDS[2]}`,
    )
    expect(rows[0]!.hydration_state).toBe('unavailable')
    const days = (new Date(rows[0]!.next_attempt_at).getTime() - Date.now()) / 86_400_000
    expect(days).toBeGreaterThan(29)
  })

  it('grants the advisory lock once', async () => {
    const db = getJobDb()
    expect(await tryAdvisoryLock(db, HYDRATE_LOCK_KEY)).toBe(true)
    await releaseAdvisoryLock(db, HYDRATE_LOCK_KEY)
  })
})
```

- [ ] **Step 7: Run and watch them fail, then pass**

Run: `pnpm test:db -- tests/db-integration/queue.test.ts`

They should pass against the implementation from Step 4. If the ordering test fails, print what the query actually returned before changing anything — the likely cause is `app_type` ordering rather than the boolean expression, which is exactly the mistake the spec calls out.

- [ ] **Step 8: Write the failing per-app write test**

```ts
// tests/db-integration/hydrate-write.test.ts
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { getJobDb } from '@/db/client'
import { writeHydratedApp } from '@/server/catalogue/hydrate-write'
import { parseAppDetails } from '@/server/steam/schemas'

const APPID = 620

const details = () => {
  const raw = JSON.parse(
    readFileSync(path.join(import.meta.dirname, '../fixtures/steam/appdetails-620.json'), 'utf8'),
  )
  const result = parseAppDetails(raw, APPID)
  if (result.kind !== 'ok') throw new Error('fixture did not parse as ok')
  return result.data
}

describe('writeHydratedApp', () => {
  beforeAll(async () => {
    const db = getJobDb()
    await db.execute(sql`delete from steam_app where appid = ${APPID}`)
    await db.execute(sql`insert into steam_app (appid, name, app_type) values (${APPID}, 'Portal 2', 'game')`)
  })

  afterAll(async () => {
    await getJobDb().execute(sql`delete from steam_app where appid = ${APPID}`)
  })

  it('writes the game, its media, genres, categories and price', async () => {
    const db = getJobDb()
    await writeHydratedApp(db, details(), 'cz', new Date())

    const game = await db.execute<{ name: string; type: string }>(
      sql`select name, type from game where appid = ${APPID}`,
    )
    expect(game.rows).toHaveLength(1)

    const media = await db.execute<{ n: number }>(
      sql`select count(*)::int as n from game_media where appid = ${APPID}`,
    )
    expect(media.rows[0]!.n).toBeGreaterThan(0)

    const genres = await db.execute<{ n: number }>(
      sql`select count(*)::int as n from game_genre where appid = ${APPID}`,
    )
    expect(genres.rows[0]!.n).toBeGreaterThan(0)
  })

  it('replaces media instead of accumulating duplicates on a second run', async () => {
    const db = getJobDb()
    const countMedia = async () =>
      (await db.execute<{ n: number }>(sql`select count(*)::int as n from game_media where appid = ${APPID}`))
        .rows[0]!.n

    const first = await countMedia()
    await writeHydratedApp(db, details(), 'cz', new Date())
    expect(await countMedia()).toBe(first)
  })

  it('appends price history only when the price changes', async () => {
    const db = getJobDb()
    const countHistory = async () =>
      (await db.execute<{ n: number }>(sql`select count(*)::int as n from price_history where appid = ${APPID}`))
        .rows[0]!.n

    const before = await countHistory()
    await writeHydratedApp(db, details(), 'cz', new Date())
    expect(await countHistory()).toBe(before)

    const data = details()
    const bumped = {
      ...data,
      price_overview: data.price_overview
        ? { ...data.price_overview, final: data.price_overview.final - 100, discount_percent: 10 }
        : undefined,
    }
    if (bumped.price_overview) {
      await writeHydratedApp(db, bumped, 'cz', new Date())
      expect(await countHistory()).toBe(before + 1)
    }
  })

  it('rolls the whole app back when one write fails', async () => {
    const db = getJobDb()
    const data = details()
    const broken = { ...data, name: 'x'.repeat(10), genres: [{ id: 'bad', description: 'x' }], dlc: [1, 2] }
    // A category id far outside smallint/int range is rejected by Postgres mid-transaction.
    const poisoned = { ...broken, categories: [{ id: 9_999_999_999, description: 'too big' }] }

    await expect(writeHydratedApp(db, poisoned, 'cz', new Date())).rejects.toThrow()

    const game = await db.execute<{ name: string }>(sql`select name from game where appid = ${APPID}`)
    expect(game.rows[0]!.name).not.toBe('x'.repeat(10))
  })
})
```

- [ ] **Step 9: Implement the write path**

```ts
// server/catalogue/hydrate-write.ts
import 'server-only'
import { and, eq, sql } from 'drizzle-orm'
import type { JobDb } from '../../db/client.ts'
import {
  category,
  game,
  gameCategory,
  gameGenre,
  gameMedia,
  genre,
  price,
  priceHistory,
} from '../../db/schema.ts'
import type { AppDetails } from '../steam/schemas.ts'
import { mapGameRow, mapMediaRows, mapPriceRow } from './map-app-details.ts'

export async function writeHydratedApp(
  db: JobDb,
  data: AppDetails,
  cc: string,
  now: Date,
): Promise<void> {
  const appid = data.steam_appid
  const gameRow = mapGameRow(data, now)
  const mediaRows = mapMediaRows(data)
  const priceRow = mapPriceRow(data, cc, now)

  await db.transaction(async (tx) => {
    await tx
      .insert(game)
      .values(gameRow)
      .onConflictDoUpdate({ target: game.appid, set: { ...gameRow, fetchedAt: now } })

    await tx.delete(gameMedia).where(eq(gameMedia.appid, appid))
    if (mediaRows.length > 0) await tx.insert(gameMedia).values(mediaRows)

    if (data.genres && data.genres.length > 0) {
      await tx
        .insert(genre)
        .values(data.genres.map((g) => ({ id: g.id, description: g.description })))
        .onConflictDoUpdate({ target: genre.id, set: { description: sql`excluded.description` } })
      await tx.delete(gameGenre).where(eq(gameGenre.appid, appid))
      await tx.insert(gameGenre).values(data.genres.map((g) => ({ appid, genreId: g.id })))
    } else {
      await tx.delete(gameGenre).where(eq(gameGenre.appid, appid))
    }

    if (data.categories && data.categories.length > 0) {
      await tx
        .insert(category)
        .values(data.categories.map((c) => ({ id: c.id, description: c.description })))
        .onConflictDoUpdate({ target: category.id, set: { description: sql`excluded.description` } })
      await tx.delete(gameCategory).where(eq(gameCategory.appid, appid))
      await tx.insert(gameCategory).values(data.categories.map((c) => ({ appid, categoryId: c.id })))
    } else {
      await tx.delete(gameCategory).where(eq(gameCategory.appid, appid))
    }

    if (priceRow) {
      const existing = await tx
        .select()
        .from(price)
        .where(and(eq(price.appid, appid), eq(price.cc, cc)))
        .limit(1)

      const previous = existing[0]
      const changed =
        !previous ||
        previous.currency !== priceRow.currency ||
        previous.initialMinor !== priceRow.initialMinor ||
        previous.finalMinor !== priceRow.finalMinor ||
        previous.discountPercent !== priceRow.discountPercent

      await tx
        .insert(price)
        .values(priceRow)
        .onConflictDoUpdate({
          target: [price.appid, price.cc],
          set: {
            currency: priceRow.currency,
            initialMinor: priceRow.initialMinor,
            finalMinor: priceRow.finalMinor,
            discountPercent: priceRow.discountPercent,
            fetchedAt: now,
          },
        })

      // price_history is the one thing here Steam cannot re-serve, so it is appended only on
      // an actual change — an unchanged observation would bloat the chart with flat points.
      if (changed) {
        await tx.insert(priceHistory).values({
          appid,
          cc,
          currency: priceRow.currency,
          initialMinor: priceRow.initialMinor,
          finalMinor: priceRow.finalMinor,
          discountPercent: priceRow.discountPercent,
          observedAt: now,
        })
      }
    }
  })
}
```

- [ ] **Step 10: Run the write tests and watch them pass**

Run: `pnpm test:db -- tests/db-integration/hydrate-write.test.ts`
Expected: PASS, four tests. Paste the output.

- [ ] **Step 11: Add the `appdetails` caller**

```ts
// server/steam/app-details.ts
import 'server-only'
import { steamFetchJson } from './client.ts'
import { type AppDetailsResult, parseAppDetails } from './schemas.ts'

export function appDetailsUrl(appid: number, cc: string, l: string): URL {
  const url = new URL('https://store.steampowered.com/api/appdetails')
  url.searchParams.set('appids', String(appid))
  url.searchParams.set('cc', cc)
  url.searchParams.set('l', l)
  return url
}

export async function fetchAppDetails(appid: number, cc: string, l: string): Promise<AppDetailsResult> {
  return parseAppDetails(await steamFetchJson(appDetailsUrl(appid, cc, l)), appid)
}
```

Add to `tests/steam/schemas.test.ts` (or a new `tests/steam/app-details.test.ts`):

```ts
it('sends cc and l with a single appid', () => {
  const url = appDetailsUrl(620, 'cz', 'english')
  expect(url.searchParams.get('appids')).toBe('620')
  expect(url.searchParams.get('cc')).toBe('cz')
  expect(url.searchParams.get('l')).toBe('english')
})
```

- [ ] **Step 12: Implement the run loop**

```ts
// server/catalogue/hydrate.ts
import 'server-only'
import { getJobDb } from '../../db/client.ts'
import { fetchAppDetails } from '../steam/app-details.ts'
import { SteamParseError } from '../steam/schemas.ts'
import { serverEnv } from '../env.ts'
import {
  HYDRATE_LOCK_KEY,
  markFailed,
  markOk,
  markUnavailable,
  releaseAdvisoryLock,
  selectDueApps,
  tryAdvisoryLock,
} from './queue.ts'
import { writeHydratedApp } from './hydrate-write.ts'

export type HydrateCounts = {
  attempted: number
  ok: number
  unavailable: number
  failed: number
  parseFailures: number
}

export type HydrateOptions = {
  maxRequests?: number
  maxDurationMs?: number
  appid?: number
  type?: 'game' | 'dlc'
  batchSize?: number
}

const DEFAULT_BATCH_SIZE = 200

// A single odd app is normal; a stream of parse failures means Valve changed the payload and
// the worker is writing nothing useful. Aborting in minutes beats marching through 183,000
// appids with a broken parser.
const PARSE_FAILURE_ABORT_COUNT = 25
const PARSE_FAILURE_ABORT_RATIO = 0.1

export async function hydrate(opts: HydrateOptions = {}): Promise<HydrateCounts> {
  const db = getJobDb()
  const { steamCountryCode: cc, steamLanguage: l } = serverEnv()
  const counts: HydrateCounts = { attempted: 0, ok: 0, unavailable: 0, failed: 0, parseFailures: 0 }

  if (!(await tryAdvisoryLock(db, HYDRATE_LOCK_KEY))) {
    console.log('another hydrate run holds the lock; exiting')
    return counts
  }

  const startedAt = Date.now()
  const budgetSpent = () =>
    (opts.maxRequests !== undefined && counts.attempted >= opts.maxRequests) ||
    (opts.maxDurationMs !== undefined && Date.now() - startedAt >= opts.maxDurationMs)

  let stopping = false
  const onSignal = () => {
    console.log('signal received; finishing the current app then exiting')
    stopping = true
  }
  process.on('SIGINT', onSignal)
  process.on('SIGTERM', onSignal)

  try {
    for (;;) {
      if (stopping || budgetSpent()) break

      const appids =
        opts.appid !== undefined
          ? [opts.appid]
          : await selectDueApps(db, { limit: opts.batchSize ?? DEFAULT_BATCH_SIZE, type: opts.type })

      if (appids.length === 0) break

      for (const appid of appids) {
        if (stopping || budgetSpent()) break
        counts.attempted += 1

        try {
          const result = await fetchAppDetails(appid, cc, l)
          if (result.kind === 'unavailable') {
            await markUnavailable(db, appid)
            counts.unavailable += 1
          } else {
            await writeHydratedApp(db, result.data, cc, new Date())
            await markOk(db, appid)
            counts.ok += 1
          }
        } catch (err) {
          await markFailed(db, appid)
          counts.failed += 1
          if (err instanceof SteamParseError) {
            counts.parseFailures += 1
            console.error(`parse failure for appid ${appid}:`, err.issues)
            if (
              counts.parseFailures >= PARSE_FAILURE_ABORT_COUNT &&
              counts.parseFailures / counts.attempted >= PARSE_FAILURE_ABORT_RATIO
            ) {
              throw new Error(
                `aborting: ${counts.parseFailures} parse failures in ${counts.attempted} attempts — the appdetails payload shape has probably changed`,
              )
            }
          } else {
            console.error(`hydration failed for appid ${appid}:`, err)
          }
        }
      }

      if (opts.appid !== undefined) break
      console.log(
        `hydrate: attempted=${counts.attempted} ok=${counts.ok} unavailable=${counts.unavailable} failed=${counts.failed}`,
      )
    }
  } finally {
    process.off('SIGINT', onSignal)
    process.off('SIGTERM', onSignal)
    await releaseAdvisoryLock(db, HYDRATE_LOCK_KEY)
  }

  return counts
}
```

- [ ] **Step 13: Add the CLI entry point**

```ts
// server/catalogue/hydrate-cli.mts
import { existsSync } from 'node:fs'

if (existsSync('.env.local')) process.loadEnvFile('.env.local')

// A hundred-hour walk over a pooled connection would hold a session advisory lock across a
// transaction pooler; the direct endpoint is the one that can hold it for the whole run.
if (process.env.DATABASE_URL_UNPOOLED) process.env.DATABASE_URL = process.env.DATABASE_URL_UNPOOLED

const { closeDb } = await import('../../db/client.ts')
const { hydrate } = await import('./hydrate.ts')

const numeric = (flag: string): number | undefined => {
  const arg = process.argv.slice(2).find((a) => a.startsWith(`${flag}=`))
  if (!arg) return undefined
  const value = Number(arg.slice(flag.length + 1))
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${flag} expects a positive number, got: ${arg.slice(flag.length + 1)}`)
  }
  return value
}

const typeArg = process.argv.slice(2).find((a) => a.startsWith('--type='))?.slice('--type='.length)
if (typeArg !== undefined && typeArg !== 'game' && typeArg !== 'dlc') {
  console.error(`--type expects game or dlc, got: ${typeArg}`)
  process.exit(1)
}

const started = Date.now()
try {
  const counts = await hydrate({
    maxRequests: numeric('--max-requests'),
    maxDurationMs: numeric('--max-duration') === undefined ? undefined : numeric('--max-duration')! * 1000,
    appid: numeric('--appid'),
    type: typeArg,
  })
  console.log(
    `hydrated ${counts.ok} ok, ${counts.unavailable} unavailable, ${counts.failed} failed ` +
      `of ${counts.attempted} attempted in ${((Date.now() - started) / 1000).toFixed(1)}s`,
  )
} catch (err) {
  console.error('hydration failed:', err)
  process.exitCode = 1
} finally {
  await closeDb()
}
```

Add to `package.json` scripts:

```json
"hydrate": "node --conditions=react-server server/catalogue/hydrate-cli.mts",
```

- [ ] **Step 14: Run the live spot checks**

Three real apps, one command each. Paste every output.

```bash
pnpm hydrate --appid=620
pnpm hydrate --appid=570
pnpm hydrate --appid=999999999
```

Then show the rows rather than asserting they exist:

```bash
node -e "
process.loadEnvFile('.env.local');
const {Pool}=require('pg');
const p=new Pool({connectionString:process.env.DATABASE_URL});
(async()=>{
  for (const q of [
    \"select appid, name, type, is_free, release_date_text from game where appid in (620,570)\",
    \"select appid, kind, count(*)::int n from game_media where appid in (620,570) group by 1,2\",
    \"select appid, cc, currency, initial_minor, final_minor, discount_percent from price where appid in (620,570)\",
    \"select appid, hydration_state, failure_count from steam_app where appid in (620,570,999999999)\",
  ]) { const r = await p.query(q); console.log(q); console.table(r.rows) }
  await p.end();
})();
"
```

Expected: 620 and 570 are `ok` with rows; 999999999 is `unavailable`. If 570 has no `price` row, that is correct — it is free.

- [ ] **Step 15: Run a short bounded batch**

```bash
pnpm hydrate --max-requests=25
```

Report the counts line and how long it took. This is the first evidence the queue ordering, limiter and write path work together on real data rather than on fixtures.

- [ ] **Step 16: Verify and commit**

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm test:db
git add db/client.ts server/steam/app-details.ts server/catalogue/ package.json tests/
git commit -m "Add the hydration worker, its queue and the per-app write transaction"
```

---

## Task 8: Batched price refresh

**Files:**
- Create: `server/catalogue/prices.ts`
- Create: `server/catalogue/prices-cli.mts`
- Create: `tests/catalogue/prices.test.ts`
- Create: `tests/db-integration/prices.test.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: `parsePriceOverviewBatch` (Task 4), `PRICES_LOCK_KEY` and the lock helpers (Task 7), the batch maximum observed in Task 1.
- Produces: `selectStalePriceAppids(db, opts)`, `applyPriceBatch(db, prices, cc, now)`, `refreshPrices(opts): Promise<PriceCounts>`, `PRICE_BATCH_SIZE`.

- [ ] **Step 1: Write the failing unit test**

```ts
// tests/catalogue/prices.test.ts
import { describe, expect, it } from 'vitest'
import { priceOverviewUrl, PRICE_BATCH_SIZE } from '@/server/catalogue/prices'

describe('priceOverviewUrl', () => {
  it('batches appids with the price_overview filter, cc and l', () => {
    const url = priceOverviewUrl([620, 570, 730], 'cz', 'english')
    expect(url.searchParams.get('appids')).toBe('620,570,730')
    expect(url.searchParams.get('filters')).toBe('price_overview')
    expect(url.searchParams.get('cc')).toBe('cz')
    expect(url.searchParams.get('l')).toBe('english')
  })

  it('refuses a batch larger than the observed maximum', () => {
    const tooMany = Array.from({ length: PRICE_BATCH_SIZE + 1 }, (_, i) => i + 1)
    expect(() => priceOverviewUrl(tooMany, 'cz', 'english')).toThrow(RangeError)
  })

  it('refuses an empty batch', () => {
    expect(() => priceOverviewUrl([], 'cz', 'english')).toThrow(RangeError)
  })
})
```

- [ ] **Step 2: Run and watch it fail**

Run: `pnpm test -- tests/catalogue/prices.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the price refresh**

Set `PRICE_BATCH_SIZE` to the value measured in Task 1, not to the number written here.

```ts
// server/catalogue/prices.ts
import 'server-only'
import { and, eq, sql } from 'drizzle-orm'
import { getJobDb, type JobDb } from '../../db/client.ts'
import { price, priceHistory } from '../../db/schema.ts'
import { steamFetchJson } from '../steam/client.ts'
import { parsePriceOverviewBatch, type PriceOverview } from '../steam/schemas.ts'
import { TTL_MS } from '../steam/ttl.ts'
import { serverEnv } from '../env.ts'
import { PRICES_LOCK_KEY, releaseAdvisoryLock, tryAdvisoryLock } from './queue.ts'

// Measured in Task 1 — see the M3 observations doc. filters=price_overview is the only
// appdetails form that accepts several appids; everything else is one appid per request.
export const PRICE_BATCH_SIZE = 10

export function priceOverviewUrl(appids: number[], cc: string, l: string): URL {
  if (appids.length === 0) throw new RangeError('priceOverviewUrl needs at least one appid')
  if (appids.length > PRICE_BATCH_SIZE) {
    throw new RangeError(`batch of ${appids.length} exceeds the observed maximum of ${PRICE_BATCH_SIZE}`)
  }
  const url = new URL('https://store.steampowered.com/api/appdetails')
  url.searchParams.set('appids', appids.join(','))
  url.searchParams.set('filters', 'price_overview')
  url.searchParams.set('cc', cc)
  url.searchParams.set('l', l)
  return url
}

export async function selectStalePriceAppids(
  db: JobDb,
  opts: { limit: number; cc: string },
): Promise<number[]> {
  const cutoff = new Date(Date.now() - TTL_MS.price)
  const { rows } = await db.execute<{ appid: number }>(sql`
    select g.appid from game g
    left join price p on p.appid = g.appid and p.cc = ${opts.cc}
    where g.is_free = false and (p.fetched_at is null or p.fetched_at < ${cutoff})
    order by p.fetched_at asc nulls first, g.appid
    limit ${opts.limit}
  `)
  return rows.map((r) => r.appid)
}

export async function applyPriceBatch(
  db: JobDb,
  prices: Map<number, PriceOverview | null>,
  cc: string,
  now: Date,
): Promise<{ written: number; changed: number }> {
  let written = 0
  let changed = 0

  for (const [appid, observed] of prices) {
    if (!observed) continue

    await db.transaction(async (tx) => {
      const existing = await tx
        .select()
        .from(price)
        .where(and(eq(price.appid, appid), eq(price.cc, cc)))
        .limit(1)

      const previous = existing[0]
      const moved =
        !previous ||
        previous.currency !== observed.currency ||
        previous.initialMinor !== observed.initialMinor ||
        previous.finalMinor !== observed.finalMinor ||
        previous.discountPercent !== observed.discountPercent

      await tx
        .insert(price)
        .values({ appid, cc, ...observed, fetchedAt: now })
        .onConflictDoUpdate({
          target: [price.appid, price.cc],
          set: { ...observed, fetchedAt: now },
        })
      written += 1

      if (moved) {
        await tx.insert(priceHistory).values({ appid, cc, ...observed, observedAt: now })
        changed += 1
      }
    })
  }

  return { written, changed }
}

export type PriceCounts = { requested: number; written: number; changed: number; batches: number }

export async function refreshPrices(
  opts: { maxRequests?: number; maxDurationMs?: number } = {},
): Promise<PriceCounts> {
  const db = getJobDb()
  const { steamCountryCode: cc, steamLanguage: l } = serverEnv()
  const counts: PriceCounts = { requested: 0, written: 0, changed: 0, batches: 0 }

  if (!(await tryAdvisoryLock(db, PRICES_LOCK_KEY))) {
    console.log('another refresh:prices run holds the lock; exiting')
    return counts
  }

  const startedAt = Date.now()
  try {
    for (;;) {
      if (opts.maxRequests !== undefined && counts.batches >= opts.maxRequests) break
      if (opts.maxDurationMs !== undefined && Date.now() - startedAt >= opts.maxDurationMs) break

      const appids = await selectStalePriceAppids(db, { limit: PRICE_BATCH_SIZE, cc })
      if (appids.length === 0) break

      counts.batches += 1
      counts.requested += appids.length

      const raw = await steamFetchJson(priceOverviewUrl(appids, cc, l))
      const applied = await applyPriceBatch(db, parsePriceOverviewBatch(raw), cc, new Date())
      counts.written += applied.written
      counts.changed += applied.changed

      // A free or delisted app returns no price, so its price row never gets a fetched_at and
      // it would be selected again forever. Stamping the row keeps the cursor moving.
      await db.execute(sql`
        update price set fetched_at = now()
        where cc = ${cc} and appid in ${sql.raw(`(${appids.join(',')})`)}
      `)
    }
  } finally {
    await releaseAdvisoryLock(db, PRICES_LOCK_KEY)
  }

  return counts
}
```

- [ ] **Step 4: Run the unit tests and watch them pass**

Run: `pnpm test -- tests/catalogue/prices.test.ts`
Expected: PASS, three tests.

- [ ] **Step 5: Write and run the database-integration test**

```ts
// tests/db-integration/prices.test.ts
import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { getJobDb } from '@/db/client'
import { applyPriceBatch } from '@/server/catalogue/prices'

const APPID = 2147482000

describe('applyPriceBatch', () => {
  beforeAll(async () => {
    const db = getJobDb()
    await db.execute(sql`delete from price_history where appid = ${APPID}`)
    await db.execute(sql`delete from steam_app where appid = ${APPID}`)
    await db.execute(sql`insert into steam_app (appid, name, app_type) values (${APPID}, 'Fixture', 'game')`)
    await db.execute(
      sql`insert into game (appid, name, type) values (${APPID}, 'Fixture', 'game')`,
    )
  })

  afterAll(async () => {
    const db = getJobDb()
    await db.execute(sql`delete from price_history where appid = ${APPID}`)
    await db.execute(sql`delete from steam_app where appid = ${APPID}`)
  })

  const observed = (finalMinor: number, discountPercent: number) =>
    new Map([[APPID, { currency: 'EUR', initialMinor: 1999, finalMinor, discountPercent }]])

  it('writes a price and its first history row', async () => {
    const result = await applyPriceBatch(getJobDb(), observed(1999, 0), 'cz', new Date())
    expect(result).toEqual({ written: 1, changed: 1 })
  })

  it('writes the price again but no history when nothing moved', async () => {
    const result = await applyPriceBatch(getJobDb(), observed(1999, 0), 'cz', new Date())
    expect(result).toEqual({ written: 1, changed: 0 })
  })

  it('appends history when the price moves', async () => {
    const result = await applyPriceBatch(getJobDb(), observed(999, 50), 'cz', new Date())
    expect(result).toEqual({ written: 1, changed: 1 })

    const { rows } = await getJobDb().execute<{ n: number }>(
      sql`select count(*)::int as n from price_history where appid = ${APPID}`,
    )
    expect(rows[0]!.n).toBe(2)
  })

  it('ignores an appid whose price came back null', async () => {
    const result = await applyPriceBatch(getJobDb(), new Map([[APPID, null]]), 'cz', new Date())
    expect(result).toEqual({ written: 0, changed: 0 })
  })
})
```

Run: `pnpm test:db -- tests/db-integration/prices.test.ts`
Expected: PASS, four tests.

- [ ] **Step 6: Add the CLI and run it live**

```ts
// server/catalogue/prices-cli.mts
import { existsSync } from 'node:fs'

if (existsSync('.env.local')) process.loadEnvFile('.env.local')
if (process.env.DATABASE_URL_UNPOOLED) process.env.DATABASE_URL = process.env.DATABASE_URL_UNPOOLED

const { closeDb } = await import('../../db/client.ts')
const { refreshPrices } = await import('./prices.ts')

const numeric = (flag: string): number | undefined => {
  const arg = process.argv.slice(2).find((a) => a.startsWith(`${flag}=`))
  if (!arg) return undefined
  const value = Number(arg.slice(flag.length + 1))
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${flag} expects a positive number, got: ${arg.slice(flag.length + 1)}`)
  }
  return value
}

const started = Date.now()
try {
  const counts = await refreshPrices({
    maxRequests: numeric('--max-requests'),
    maxDurationMs: numeric('--max-duration') === undefined ? undefined : numeric('--max-duration')! * 1000,
  })
  console.log(
    `refreshed ${counts.written} prices (${counts.changed} changed) across ${counts.batches} batches ` +
      `in ${((Date.now() - started) / 1000).toFixed(1)}s`,
  )
} catch (err) {
  console.error('price refresh failed:', err)
  process.exitCode = 1
} finally {
  await closeDb()
}
```

Add to `package.json` scripts:

```json
"refresh:prices": "node --conditions=react-server server/catalogue/prices-cli.mts",
```

Run it against the games hydrated in Task 7 and paste the output:

```bash
pnpm refresh:prices --max-requests=2
```

- [ ] **Step 7: Verify and commit**

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm test:db
git add server/catalogue/prices.ts server/catalogue/prices-cli.mts package.json tests/
git commit -m "Add the batched price refresh with append-on-change history"
```

---

## Task 9: On-demand review summaries

**Files:**
- Create: `server/steam/reviews.ts`
- Create: `server/catalogue/review-summary.ts`
- Create: `tests/steam/reviews.test.ts`
- Create: `tests/db-integration/review-summary.test.ts`

**Interfaces:**
- Consumes: `parseReviewSummary` (Task 4), `readThrough` and `TTL_MS.reviewSummary` (Task 5).
- Produces: `reviewsUrl(appid: number): URL`, `fetchReviewSummary(appid: number): Promise<ReviewSummary>`, `getReviewSummary(appid: number): Promise<ReviewSummary | undefined>` — the read-through entry point M5's detail page will call.

- [ ] **Step 1: Write the failing URL test**

```ts
// tests/steam/reviews.test.ts
import { describe, expect, it } from 'vitest'
import { reviewsUrl } from '@/server/steam/reviews'

describe('reviewsUrl', () => {
  it('pins num_per_page=0 and purchase_type=all', () => {
    const url = reviewsUrl(620)
    expect(url.pathname).toBe('/appreviews/620')
    expect(url.searchParams.get('json')).toBe('1')
    // Bodies must never arrive in the first place, and purchase_type defaults to steam,
    // which moves the totals by about 6%.
    expect(url.searchParams.get('num_per_page')).toBe('0')
    expect(url.searchParams.get('purchase_type')).toBe('all')
  })
})
```

- [ ] **Step 2: Run and watch it fail**

Run: `pnpm test -- tests/steam/reviews.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the fetcher and the read-through**

```ts
// server/steam/reviews.ts
import 'server-only'
import { steamFetchJson } from './client.ts'
import { parseReviewSummary, type ReviewSummary } from './schemas.ts'

export function reviewsUrl(appid: number): URL {
  const url = new URL(`https://store.steampowered.com/appreviews/${appid}`)
  url.searchParams.set('json', '1')
  // num_per_page=0 means review bodies never arrive, rather than arriving and being
  // discarded. purchase_type must be pinned: it defaults to steam, and the totals move with
  // it — a ~6% swing was observed between steam and all.
  url.searchParams.set('num_per_page', '0')
  url.searchParams.set('purchase_type', 'all')
  return url
}

export async function fetchReviewSummary(appid: number): Promise<ReviewSummary> {
  return parseReviewSummary(await steamFetchJson(reviewsUrl(appid)))
}
```

```ts
// server/catalogue/review-summary.ts
import 'server-only'
import { eq } from 'drizzle-orm'
import { getDb } from '../../db/client.ts'
import { reviewSummary } from '../../db/schema.ts'
import { readThrough } from '../steam/cache.ts'
import { fetchReviewSummary } from '../steam/reviews.ts'
import type { ReviewSummary } from '../steam/schemas.ts'
import { TTL_MS } from '../steam/ttl.ts'

export async function getReviewSummary(appid: number): Promise<ReviewSummary | undefined> {
  try {
    return await readThrough<ReviewSummary>({
      label: `appreviews ${appid}`,
      ttlMs: TTL_MS.reviewSummary,
      load: async () => {
        const rows = await getDb()
          .select()
          .from(reviewSummary)
          .where(eq(reviewSummary.appid, appid))
          .limit(1)
        const row = rows[0]
        if (!row) return undefined
        return {
          value: {
            reviewScore: row.reviewScore ?? undefined,
            reviewScoreDesc: row.reviewScoreDesc ?? undefined,
            totalPositive: row.totalPositive ?? 0,
            totalNegative: row.totalNegative ?? 0,
            totalReviews: row.totalReviews ?? 0,
          },
          fetchedAt: row.fetchedAt,
        }
      },
      refresh: async () => {
        const summary = await fetchReviewSummary(appid)
        const now = new Date()
        await getDb()
          .insert(reviewSummary)
          .values({
            appid,
            reviewScore: summary.reviewScore ?? null,
            reviewScoreDesc: summary.reviewScoreDesc ?? null,
            totalPositive: summary.totalPositive,
            totalNegative: summary.totalNegative,
            totalReviews: summary.totalReviews,
            fetchedAt: now,
          })
          .onConflictDoUpdate({
            target: reviewSummary.appid,
            set: {
              reviewScore: summary.reviewScore ?? null,
              reviewScoreDesc: summary.reviewScoreDesc ?? null,
              totalPositive: summary.totalPositive,
              totalNegative: summary.totalNegative,
              totalReviews: summary.totalReviews,
              fetchedAt: now,
            },
          })
        return summary
      },
    })
  } catch (err) {
    // A detail page without a review score is a worse page, not a broken one.
    console.error(`review summary unavailable for appid ${appid}:`, err)
    return undefined
  }
}
```

- [ ] **Step 4: Run the URL test and watch it pass**

Run: `pnpm test -- tests/steam/reviews.test.ts`
Expected: PASS.

- [ ] **Step 5: Write and run the database-integration test**

```ts
// tests/db-integration/review-summary.test.ts
import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { getDb, getJobDb } from '@/db/client'
import { getReviewSummary } from '@/server/catalogue/review-summary'

const APPID = 620

describe('getReviewSummary', () => {
  beforeAll(async () => {
    const db = getJobDb()
    await db.execute(sql`delete from review_summary where appid = ${APPID}`)
    await db.execute(sql`insert into steam_app (appid, name, app_type) values (${APPID}, 'Portal 2', 'game')
                         on conflict (appid) do nothing`)
    await db.execute(sql`insert into game (appid, name, type) values (${APPID}, 'Portal 2', 'game')
                         on conflict (appid) do nothing`)
  })

  afterAll(async () => {
    await getJobDb().execute(sql`delete from review_summary where appid = ${APPID}`)
  })

  it('fetches, stores and then serves from cache', async () => {
    const first = await getReviewSummary(APPID)
    expect(first).toBeDefined()
    expect(first!.totalReviews).toBeGreaterThan(0)

    const { rows } = await getDb().execute<{ n: number }>(
      sql`select count(*)::int as n from review_summary where appid = ${APPID}`,
    )
    expect(rows[0]!.n).toBe(1)

    const second = await getReviewSummary(APPID)
    expect(second).toEqual(first)
  })

  it('never stores review bodies or author data', async () => {
    const { rows } = await getDb().execute<{ column_name: string }>(
      sql`select column_name from information_schema.columns where table_name = 'review_summary'`,
    )
    const names = rows.map((r) => r.column_name)
    for (const forbidden of ['review', 'author', 'steamid', 'personaname', 'playtime']) {
      expect(names.some((n) => n.includes(forbidden))).toBe(false)
    }
  })
})
```

This test calls Steam for real. Run it and paste the output:

Run: `pnpm test:db -- tests/db-integration/review-summary.test.ts`

- [ ] **Step 6: Verify and commit**

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm test:db
git add server/steam/reviews.ts server/catalogue/review-summary.ts tests/
git commit -m "Fetch aggregate review summaries on demand through the TTL cache"
```

---

## Task 10: Documentation and the container path

**Files:**
- Modify: `CLAUDE.md`
- Modify: `Dockerfile` (only if the new files fall outside what it already copies)
- Modify: `docs/superpowers/specs/2026-08-30-m3-observations.md`

**Interfaces:**
- Consumes: everything above.
- Produces: no code. The repository's documentation matches what the code now does.

- [ ] **Step 1: Update the commands block in `CLAUDE.md`**

Add under the existing entries, matching their style:

```
pnpm hydrate          # fill in appdetails for pending apps; --max-requests, --max-duration,
                      # --appid, --type=game|dlc
pnpm refresh:prices   # batched price refresh; appends price_history only on change
```

- [ ] **Step 2: Correct the environment section**

`DATABASE_URL_UNPOOLED` is documented as "direct connection, migrations only". It is now used by the jobs too. Change the comment to `# direct connection: migrations and the one-off jobs`.

Add `STEAM_STOREFRONT_RPS` with the measured value and a note saying where the measurement is recorded. Add `STEAM_LANGUAGE # defaults to english`.

- [ ] **Step 3: Confirm the container can run the jobs**

`CLAUDE.md` states the runtime stage copies `db/`, `server/` and the runtime-only packages they import. `isomorphic-dompurify` is new, and it is imported by `server/catalogue/map-app-details.ts`, so it must be present in the runtime image.

```bash
docker build -t games-app .
sed -E 's/^([A-Z_]+)="(.*)"$/\1=\2/' .env.local > .env.docker
docker run --rm --env-file .env.docker games-app node --conditions=react-server server/catalogue/hydrate-cli.mts --appid=620
```

Paste the output. If it fails on a missing module, add that package to the runtime stage's copy list in the `Dockerfile` and rebuild — do not work around it by moving application code.

Delete `.env.docker` afterwards; it holds real credentials.

- [ ] **Step 4: Fill in the observations document**

Every item in spec §8 now has either a recorded observation or the words "not verified". Make sure the pinned values in `limiter.ts` (`DEFAULT_STOREFRONT_RPS`) and `prices.ts` (`PRICE_BATCH_SIZE`) match what the document records, and that no file states a rate limit this project did not measure.

- [ ] **Step 5: Full verification**

```bash
pnpm lint && pnpm typecheck && pnpm build && pnpm test && pnpm test:db
```

Paste all five outputs.

- [ ] **Step 6: Commit and open the pull request**

```bash
git add CLAUDE.md Dockerfile docs/
git commit -m "Document the hydration jobs and record the M3 observations"
git push -u origin feat/m3-hydration
gh pr create --title "M3: Steam client and hydration" --body "$(cat <<'BODY'
Adds the rate-limited Steam client, the payload parsers, the TTL and read-through cache,
the hydration worker, the batched price refresh, and on-demand review summaries.

## Verified in this session

- [paste: fixture capture and what each fixture contains]
- [paste: measured storefront rate and the pinned default]
- [paste: price_overview batch maximum and the pinned batch size]
- [paste: advisory lock behaviour on both endpoints]
- [paste: pnpm lint / typecheck / build / test / test:db output]
- [paste: live spot checks for 620, 570, 999999999 and the resulting rows]
- [paste: the bounded batch run and its counts]

## Not verified

- [list anything left unverified, with what would be needed to verify it]

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01HijvF153ELhxhosHP6Gdrg
BODY
)"
```

The two placeholder lists must be filled with real output before the pull request is opened. A PR body claiming verification without pasted evidence violates the project's first rule.

---

## Notes for the executor

- **Task 1 is not optional and cannot be reordered.** Tasks 4, 6, 7 and 8 are written against fixtures that do not exist until it runs.
- **Where this plan and a live payload disagree, the payload wins.** Change the code, and say so in your report. The field lists here reflect what `db/schema.ts` declares, which is itself derived from observations made on 2026-08-29 — they may have moved.
- **The backfill is not part of any task.** Once Task 10 is merged, `pnpm hydrate` runs for as long as you let it. Starting that run is the user's call, not the executor's.
