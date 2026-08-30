# M2 Catalogue Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `pnpm sync:catalogue` pulls every game and DLC appid from `IStoreService/GetAppList` and upserts them into `steam_app`, runnable locally and as a one-off command in the container.

**Architecture:** A single Steam HTTP client that everything else calls, a Zod-validated page parser exposing the list as an async generator, a sync module that runs two passes and batches upserts, and a thin CLI entry. The upsert touches only list-derived columns so M3's hydration queue is never reset.

**Tech Stack:** TypeScript, Zod 4, Drizzle ORM, node-postgres, Vitest. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-08-30-m2-catalogue-sync-design.md`

## Global Constraints

- No new libraries, ORMs, state managers or UI kits without asking first.
- Every increment lands as branch → commit → push → `gh pr create`. Nothing goes straight to `main`.
- Never claim something works without evidence in the same message: a command you ran and its output, a file you read, or a passing test.
- Nothing calls `fetch` against Steam except `server/steam/client.ts`.
- `pnpm build` must succeed with no `DATABASE_URL`. If that breaks, remove module-scope database access — never add the variable to the build.
- Comments earn their place only when they record why, a source for a magic value, or a genuine sharp edge. No comments restating the code.
- Verified endpoint facts live in the spec. Do not contradict them from memory.

### Verified GetAppList facts (from the spec — do not re-derive)

- Terminal page omits both `have_more_results` and `last_appid`. Terminate on `have_more_results`.
- `last_appid` is an **exclusive** cursor. Pass it through unchanged.
- `max_results` caps at 50000.
- A 403 body is **HTML**, not JSON.
- `include_games=false` with no other include flag returns junk (`{"appid":1,"name":"Action"}`). Always pass flags explicitly.
- Games and DLC passes are disjoint: 0 overlapping appids.
- The catalogue is live — 183100 then 183101 within an hour. **No test may assert an exact count.**

---

### Task 1: Steam HTTP client

**Files:**
- Create: `server/steam/client.ts`
- Test: `tests/steam/client.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `class SteamHttpError extends Error { status: number; bodyPreview: string }`; `steamFetchJson(url: URL, opts?: { retries?: number; backoffMs?: number }): Promise<unknown>`

- [ ] **Step 1: Write the failing test**

`tests/steam/client.test.ts`:

```typescript
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SteamHttpError, steamFetchJson } from '@/server/steam/client'

const url = new URL('https://api.steampowered.com/IStoreService/GetAppList/v1/')

afterEach(() => vi.unstubAllGlobals())

function respond(status: number, body: string, contentType = 'application/json') {
  return new Response(body, { status, headers: { 'content-type': contentType } })
}

describe('steamFetchJson', () => {
  it('returns parsed JSON on success', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => respond(200, '{"response":{"apps":[]}}')))
    expect(await steamFetchJson(url)).toEqual({ response: { apps: [] } })
  })

  it('reports the status rather than a JSON syntax error when the body is HTML', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      respond(403, '<html><head><title>Forbidden</title></head></html>', 'text/html'),
    ))
    const err = await steamFetchJson(url, { retries: 0 }).catch((e) => e)
    expect(err).toBeInstanceOf(SteamHttpError)
    expect(err.status).toBe(403)
    expect(err.message).toContain('403')
  })

  it('does not retry a 403', async () => {
    const spy = vi.fn(async () => respond(403, '<html></html>', 'text/html'))
    vi.stubGlobal('fetch', spy)
    await steamFetchJson(url, { retries: 3, backoffMs: 1 }).catch(() => {})
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('retries a 429 and succeeds', async () => {
    const spy = vi
      .fn()
      .mockResolvedValueOnce(respond(429, 'slow down', 'text/plain'))
      .mockResolvedValueOnce(respond(200, '{"ok":true}'))
    vi.stubGlobal('fetch', spy)
    expect(await steamFetchJson(url, { retries: 2, backoffMs: 1 })).toEqual({ ok: true })
    expect(spy).toHaveBeenCalledTimes(2)
  })

  it('gives up after the retry budget and reports the last status', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => respond(500, 'boom', 'text/plain')))
    const err = await steamFetchJson(url, { retries: 2, backoffMs: 1 }).catch((e) => e)
    expect(err).toBeInstanceOf(SteamHttpError)
    expect(err.status).toBe(500)
  })

  it('rejects a 200 whose body is not JSON', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => respond(200, 'not json', 'text/plain')))
    await expect(steamFetchJson(url, { retries: 0 })).rejects.toThrow(/not valid JSON/i)
  })
})
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `pnpm vitest run tests/steam/client.test.ts`
Expected: FAIL — cannot resolve `@/server/steam/client`.

- [ ] **Step 3: Implement**

`server/steam/client.ts`:

```typescript
import 'server-only'

export class SteamHttpError extends Error {
  constructor(
    readonly status: number,
    readonly bodyPreview: string,
  ) {
    super(`Steam returned HTTP ${status}: ${bodyPreview.slice(0, 120)}`)
    this.name = 'SteamHttpError'
  }
}

type FetchOptions = { retries?: number; backoffMs?: number }

const RETRYABLE = new Set([429, 500, 502, 503, 504])

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export async function steamFetchJson(url: URL, opts: FetchOptions = {}): Promise<unknown> {
  const retries = opts.retries ?? 3
  const backoffMs = opts.backoffMs ?? 1000

  let lastError: SteamHttpError | undefined
  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await fetch(url)
    // The 403 body is HTML, so the status must be checked before any parse attempt.
    const body = await res.text()

    if (res.ok) {
      try {
        return JSON.parse(body)
      } catch {
        throw new Error(`Steam returned 200 but the body is not valid JSON: ${body.slice(0, 120)}`)
      }
    }

    lastError = new SteamHttpError(res.status, body)
    if (!RETRYABLE.has(res.status) || attempt === retries) break

    const retryAfter = Number(res.headers.get('retry-after'))
    await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : backoffMs * 2 ** attempt)
  }

  throw lastError
}
```

- [ ] **Step 4: Run the test**

Run: `pnpm vitest run tests/steam/client.test.ts`
Expected: 6 passed.

- [ ] **Step 5: Commit**

```bash
git add server/steam/client.ts tests/steam/client.test.ts
git commit -m "Add the single Steam HTTP client with backoff and non-JSON error handling"
```

---

### Task 2: App list parser and walker

**Files:**
- Create: `server/steam/app-list.ts`
- Create: `tests/fixtures/steam/app-list-page.json`
- Create: `tests/fixtures/steam/app-list-terminal-page.json`
- Test: `tests/steam/app-list.test.ts`

**Interfaces:**
- Consumes: `steamFetchJson`, `SteamHttpError` from Task 1.
- Produces:
  - `type SteamAppListEntry = { appid: number; name: string; lastModified?: number }`
  - `type AppListPage = { apps: SteamAppListEntry[]; haveMore: boolean; lastAppid?: number }`
  - `type AppListFlags = { includeGames?: boolean; includeDlc?: boolean; ifModifiedSince?: number }`
  - `parseAppListPage(raw: unknown): AppListPage`
  - `walkAppList(key: string, flags: AppListFlags, opts?: { maxResults?: number; delayMs?: number }): AsyncGenerator<SteamAppListEntry[]>`

- [ ] **Step 1: Write the fixtures**

`tests/fixtures/steam/app-list-page.json` — captured live 2026-08-30:

```json
{
  "response": {
    "apps": [
      { "appid": 10, "name": "Counter-Strike", "last_modified": 1745368572, "price_change_number": 37149137 },
      { "appid": 20, "name": "Team Fortress Classic", "last_modified": 1745368565, "price_change_number": 37149137 },
      { "appid": 30, "name": "Day of Defeat", "last_modified": 1745368580, "price_change_number": 37149137 }
    ],
    "have_more_results": true,
    "last_appid": 508530
  }
}
```

`tests/fixtures/steam/app-list-terminal-page.json` — the real shape of the last page, with both keys absent:

```json
{
  "response": {
    "apps": [
      { "appid": 508530, "name": "HackyZack", "last_modified": 1569623636, "price_change_number": 26388145 }
    ]
  }
}
```

- [ ] **Step 2: Write the failing test**

`tests/steam/app-list.test.ts`:

```typescript
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseAppListPage, walkAppList } from '@/server/steam/app-list'

const fixture = (name: string) =>
  JSON.parse(readFileSync(path.join(import.meta.dirname, '../fixtures/steam', name), 'utf8'))

afterEach(() => vi.unstubAllGlobals())

describe('parseAppListPage', () => {
  it('parses a full page', () => {
    const page = parseAppListPage(fixture('app-list-page.json'))
    expect(page.apps).toHaveLength(3)
    expect(page.apps[0]).toEqual({ appid: 10, name: 'Counter-Strike', lastModified: 1745368572 })
    expect(page.haveMore).toBe(true)
    expect(page.lastAppid).toBe(508530)
  })

  it('treats a page with neither cursor nor have_more_results as terminal', () => {
    const page = parseAppListPage(fixture('app-list-terminal-page.json'))
    expect(page.apps).toHaveLength(1)
    expect(page.haveMore).toBe(false)
    expect(page.lastAppid).toBeUndefined()
  })

  it('rejects a malformed page', () => {
    expect(() => parseAppListPage({ response: { apps: [{ appid: 'ten' }] } })).toThrow()
  })
})

describe('walkAppList', () => {
  it('stops on the terminal page and passes the cursor through unchanged', async () => {
    const urls: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (u: URL) => {
        urls.push(u.toString())
        const body = urls.length === 1 ? fixture('app-list-page.json') : fixture('app-list-terminal-page.json')
        return new Response(JSON.stringify(body), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }),
    )

    const batches = []
    for await (const batch of walkAppList('KEY', { includeGames: true }, { delayMs: 0 })) batches.push(batch)

    expect(batches).toHaveLength(2)
    expect(urls).toHaveLength(2)
    expect(urls[0]).toContain('last_appid=0')
    expect(urls[1]).toContain('last_appid=508530')
    expect(urls[0]).toContain('include_games=true')
  })

  it('sends if_modified_since when asked', async () => {
    const urls: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (u: URL) => {
        urls.push(u.toString())
        return new Response(JSON.stringify(fixture('app-list-terminal-page.json')), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }),
    )
    for await (const _ of walkAppList('KEY', { includeGames: true, ifModifiedSince: 1700000000 }, { delayMs: 0 })) {
      void _
    }
    expect(urls[0]).toContain('if_modified_since=1700000000')
  })
})
```

- [ ] **Step 3: Run it and confirm it fails**

Run: `pnpm vitest run tests/steam/app-list.test.ts`
Expected: FAIL — cannot resolve `@/server/steam/app-list`.

- [ ] **Step 4: Implement**

`server/steam/app-list.ts`:

```typescript
import 'server-only'
import { z } from 'zod'
import { steamFetchJson } from './client.ts'

const entrySchema = z.object({
  appid: z.number().int(),
  name: z.string(),
  last_modified: z.number().int().optional(),
})

const pageSchema = z.object({
  response: z.object({
    apps: z.array(entrySchema).default([]),
    have_more_results: z.boolean().optional(),
    last_appid: z.number().int().optional(),
  }),
})

export type SteamAppListEntry = { appid: number; name: string; lastModified?: number }
export type AppListPage = { apps: SteamAppListEntry[]; haveMore: boolean; lastAppid?: number }
export type AppListFlags = { includeGames?: boolean; includeDlc?: boolean; ifModifiedSince?: number }

export const MAX_RESULTS = 50000

export function parseAppListPage(raw: unknown): AppListPage {
  const { response } = pageSchema.parse(raw)
  return {
    apps: response.apps.map((a) => ({ appid: a.appid, name: a.name, lastModified: a.last_modified })),
    haveMore: response.have_more_results ?? false,
    lastAppid: response.last_appid,
  }
}

export async function* walkAppList(
  key: string,
  flags: AppListFlags,
  opts: { maxResults?: number; delayMs?: number } = {},
): AsyncGenerator<SteamAppListEntry[]> {
  const maxResults = opts.maxResults ?? MAX_RESULTS
  const delayMs = opts.delayMs ?? 1200
  let cursor = 0

  for (;;) {
    const url = new URL('https://api.steampowered.com/IStoreService/GetAppList/v1/')
    url.searchParams.set('key', key)
    url.searchParams.set('max_results', String(maxResults))
    url.searchParams.set('last_appid', String(cursor))
    url.searchParams.set('include_games', String(flags.includeGames ?? false))
    url.searchParams.set('include_dlc', String(flags.includeDlc ?? false))
    if (flags.ifModifiedSince !== undefined) {
      url.searchParams.set('if_modified_since', String(flags.ifModifiedSince))
    }

    const page = parseAppListPage(await steamFetchJson(url))
    yield page.apps

    // The terminal page omits both keys, so the cursor alone cannot end the loop.
    if (!page.haveMore || page.lastAppid === undefined) return

    cursor = page.lastAppid
    if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs))
  }
}
```

- [ ] **Step 5: Run the test**

Run: `pnpm vitest run tests/steam/app-list.test.ts`
Expected: 5 passed.

- [ ] **Step 6: Commit**

```bash
git add server/steam/app-list.ts tests/steam/app-list.test.ts tests/fixtures/steam
git commit -m "Add the GetAppList page parser and cursor walker"
```

---

### Task 3: Make the database client usable from a CLI

**Files:**
- Modify: `db/client.ts`
- Modify: `tsconfig.json`
- Test: `tests/db/client.test.ts` (add one case)

**Interfaces:**
- Consumes: nothing.
- Produces: `closeDb(): Promise<void>`

**Why:** M1 deferred findings #5a and #4a. A CLI holding an open `pg.Pool` never exits. Node also cannot resolve the extensionless `./schema` import when running the file directly, which the CLI in Task 5 does.

- [ ] **Step 1: Add the failing test**

Append to `tests/db/client.test.ts`:

```typescript
describe('closeDb', () => {
  it('is safe to call when no client was ever created', async () => {
    const { closeDb } = await import('@/db/client')
    await expect(closeDb()).resolves.toBeUndefined()
  })
})
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `pnpm vitest run tests/db/client.test.ts`
Expected: FAIL — `closeDb` is not exported.

- [ ] **Step 3: Implement**

In `db/client.ts`, change the schema import to carry an explicit extension so Node's resolver can follow it when the file is executed directly:

```typescript
import * as schema from './schema.ts'
```

Track the pool so it can be closed, replacing the existing `createDb` pool branch and `instance` declaration:

```typescript
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

// A CLI job holding an open pool never exits. Serverless callers never need this.
export async function closeDb(): Promise<void> {
  await pool?.end()
  pool = undefined
  instance = undefined
}
```

In `tsconfig.json`, add to `compilerOptions` so TypeScript accepts the `.ts` specifier (permitted because `noEmit` is already true):

```json
"allowImportingTsExtensions": true,
```

- [ ] **Step 4: Run the test**

Run: `pnpm vitest run tests/db/client.test.ts`
Expected: PASS.

- [ ] **Step 5: Prove the `.ts` specifier broke nothing**

Run each and paste the output:

```bash
pnpm lint
pnpm typecheck
pnpm test
env -u DATABASE_URL pnpm build
```

Expected: all exit 0, and the build still succeeds without `DATABASE_URL`. If the build fails on the `.ts` specifier, stop and report — do not work around it by reverting to a second client.

- [ ] **Step 6: Commit**

```bash
git add db/client.ts tsconfig.json tests/db/client.test.ts
git commit -m "Add closeDb and an explicit schema specifier so CLI jobs can run"
```

---

### Task 4: Catalogue sync

**Files:**
- Create: `server/catalogue/sync.ts`
- Test: `tests/catalogue/sync.test.ts`
- Test: `tests/db-integration/catalogue-upsert.test.ts`

**Interfaces:**
- Consumes: `walkAppList`, `SteamAppListEntry` (Task 2); `getDb` (Task 3); `steamApp` from `db/schema.ts`.
- Produces:
  - `type SyncCounts = { games: number; dlc: number; total: number }`
  - `upsertAppBatch(db: Db, rows: SteamAppListEntry[], appType: string, seenAt: Date): Promise<void>`
  - `syncCatalogue(opts: { key: string; ifModifiedSince?: number; chunkSize?: number; delayMs?: number }): Promise<SyncCounts>`

- [ ] **Step 1: Write the failing unit test**

`tests/catalogue/sync.test.ts`:

```typescript
import { describe, expect, it } from 'vitest'
import { chunk } from '@/server/catalogue/sync'

describe('chunk', () => {
  it('splits into batches of the requested size', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]])
  })

  it('returns nothing for an empty list', () => {
    expect(chunk([], 100)).toEqual([])
  })

  it('returns a single batch when the list is smaller than the size', () => {
    expect(chunk([1, 2], 100)).toEqual([[1, 2]])
  })
})
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `pnpm vitest run tests/catalogue/sync.test.ts`
Expected: FAIL — cannot resolve `@/server/catalogue/sync`.

- [ ] **Step 3: Implement**

`server/catalogue/sync.ts`:

```typescript
import 'server-only'
import { sql } from 'drizzle-orm'
import { type Db, getDb } from '../../db/client.ts'
import { steamApp } from '../../db/schema.ts'
import { type SteamAppListEntry, walkAppList } from '../steam/app-list.ts'

export type SyncCounts = { games: number; dlc: number; total: number }

// Four columns per row against Postgres' 65535-parameter ceiling.
const DEFAULT_CHUNK_SIZE = 2000

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

export async function upsertAppBatch(
  db: Db,
  rows: SteamAppListEntry[],
  appType: string,
  seenAt: Date,
): Promise<void> {
  if (rows.length === 0) return

  await db
    .insert(steamApp)
    .values(rows.map((r) => ({ appid: r.appid, name: r.name, appType, lastSeenInListAt: seenAt })))
    .onConflictDoUpdate({
      target: steamApp.appid,
      // hydration_state, failure_count and next_attempt_at belong to the hydration queue.
      // Writing them here would re-queue the whole catalogue on every sync.
      set: {
        name: sql`excluded.name`,
        appType: sql`excluded.app_type`,
        lastSeenInListAt: sql`excluded.last_seen_in_list_at`,
      },
    })
}

async function runPass(
  db: Db,
  key: string,
  flags: { includeGames?: boolean; includeDlc?: boolean; ifModifiedSince?: number },
  appType: string,
  seenAt: Date,
  chunkSize: number,
  delayMs: number,
): Promise<number> {
  let count = 0
  for await (const batch of walkAppList(key, flags, { delayMs })) {
    for (const part of chunk(batch, chunkSize)) {
      await upsertAppBatch(db, part, appType, seenAt)
    }
    count += batch.length
    console.log(`  ${appType}: ${count} appids upserted`)
  }
  return count
}

export async function syncCatalogue(opts: {
  key: string
  ifModifiedSince?: number
  chunkSize?: number
  delayMs?: number
}): Promise<SyncCounts> {
  const db = getDb()
  const seenAt = new Date()
  const chunkSize = opts.chunkSize ?? DEFAULT_CHUNK_SIZE
  const delayMs = opts.delayMs ?? 1200
  const since = opts.ifModifiedSince

  const games = await runPass(
    db, opts.key,
    { includeGames: true, includeDlc: false, ifModifiedSince: since },
    'game', seenAt, chunkSize, delayMs,
  )
  const dlc = await runPass(
    db, opts.key,
    { includeGames: false, includeDlc: true, ifModifiedSince: since },
    'dlc', seenAt, chunkSize, delayMs,
  )

  return { games, dlc, total: games + dlc }
}
```

- [ ] **Step 4: Run the unit test**

Run: `pnpm vitest run tests/catalogue/sync.test.ts`
Expected: 3 passed.

- [ ] **Step 5: Write the database integration test**

`tests/db-integration/catalogue-upsert.test.ts`:

```typescript
import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { getDb } from '@/db/client'
import { steamApp } from '@/db/schema'
import { upsertAppBatch } from '@/server/catalogue/sync'

const APPID = 2147480000

describe('upsertAppBatch', () => {
  beforeAll(async () => {
    await getDb().execute(sql`delete from steam_app where appid = ${APPID}`)
  })
  afterAll(async () => {
    await getDb().execute(sql`delete from steam_app where appid = ${APPID}`)
  })

  it('inserts a new row as pending', async () => {
    const db = getDb()
    await upsertAppBatch(db, [{ appid: APPID, name: 'Fixture One' }], 'game', new Date('2026-01-01'))

    const { rows } = await db.execute<{
      name: string
      app_type: string
      hydration_state: string
      failure_count: number
    }>(sql`select name, app_type, hydration_state, failure_count from steam_app where appid = ${APPID}`)

    expect(rows[0]).toMatchObject({
      name: 'Fixture One',
      app_type: 'game',
      hydration_state: 'pending',
      failure_count: 0,
    })
  })

  it('updates the name but never the hydration queue columns', async () => {
    const db = getDb()
    await db.execute(
      sql`update steam_app set hydration_state = 'ok', failure_count = 4,
          next_attempt_at = '2030-01-01' where appid = ${APPID}`,
    )

    await upsertAppBatch(db, [{ appid: APPID, name: 'Fixture Renamed' }], 'game', new Date('2026-02-02'))

    const { rows } = await db.execute<{
      name: string
      hydration_state: string
      failure_count: number
      next_attempt_at: string
      last_seen_in_list_at: string
    }>(sql`select name, hydration_state, failure_count, next_attempt_at, last_seen_in_list_at
           from steam_app where appid = ${APPID}`)

    expect(rows[0]!.name).toBe('Fixture Renamed')
    expect(rows[0]!.hydration_state).toBe('ok')
    expect(rows[0]!.failure_count).toBe(4)
    expect(new Date(rows[0]!.next_attempt_at).getUTCFullYear()).toBe(2030)
    expect(new Date(rows[0]!.last_seen_in_list_at).getUTCMonth()).toBe(1)
  })
})
```

- [ ] **Step 6: Run it against the real database**

Run: `pnpm test:db`
Expected: the two migrate tests plus these two pass. Paste the output.

- [ ] **Step 7: Commit**

```bash
git add server/catalogue/sync.ts tests/catalogue tests/db-integration/catalogue-upsert.test.ts
git commit -m "Add the catalogue sync with an upsert that preserves the hydration queue"
```

---

### Task 5: CLI entry and the pnpm script

**Files:**
- Create: `server/catalogue/cli.mts`
- Modify: `package.json`
- Modify: `.env.example`

**Interfaces:**
- Consumes: `syncCatalogue`, `SyncCounts` (Task 4); `closeDb` (Task 3).
- Produces: the `sync:catalogue` script.

**Why `.mts` and `--conditions=react-server`:** Node 24 strips types natively, so no transpiler is needed. `.mts` marks the entry as ESM without adding `"type": "module"` to `package.json`. `server-only` throws unless the `react-server` export condition is active. Both were verified working against the real database on 2026-08-30.

- [ ] **Step 1: Implement the CLI**

`server/catalogue/cli.mts`:

```typescript
import { existsSync } from 'node:fs'

if (existsSync('.env.local')) process.loadEnvFile('.env.local')

const { closeDb } = await import('../../db/client.ts')
const { syncCatalogue } = await import('./sync.ts')

function parseSince(argv: string[]): number | undefined {
  const arg = argv.find((a) => a.startsWith('--since='))
  if (!arg) return undefined

  const value = arg.slice('--since='.length)
  const days = Number(value)
  if (Number.isFinite(days) && days > 0) return Math.floor(Date.now() / 1000) - days * 86400

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) throw new Error(`--since expects a day count or an ISO date, got: ${value}`)
  return Math.floor(date.getTime() / 1000)
}

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
  console.error('catalogue sync failed:', err instanceof Error ? err.message : err)
  process.exitCode = 1
} finally {
  await closeDb()
}
```

- [ ] **Step 2: Add the script**

In `package.json` `scripts`:

```json
"sync:catalogue": "node --conditions=react-server server/catalogue/cli.mts"
```

- [ ] **Step 3: Document the variable**

`.env.example` already lists `STEAM_API_KEY`. Confirm the comment above it still reads that `IStoreService/GetAppList` returns 403 without it. If not, restore it.

- [ ] **Step 4: Run it for real**

```bash
pnpm sync:catalogue
```

Expected: progress lines for both passes, then a summary naming a games count near 183000 and a DLC count near 62000. **The process must exit on its own.** If it hangs, `closeDb` is not being reached.

Paste the real output.

- [ ] **Step 5: Prove it against the database**

```bash
pnpm test:db
```

Then confirm the row counts directly and paste the result:

Write `.count-apps.mts` (delete it afterwards — it is a throwaway, not a deliverable):

```typescript
process.loadEnvFile('.env.local')
const { Pool } = await import('pg')
const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const r = await pool.query(
  'select app_type, count(*)::int n from steam_app group by app_type order by n desc',
)
console.log(r.rows)
await pool.end()
```

```bash
node .count-apps.mts && rm -f .count-apps.mts
```

Expected: a `game` row and a `dlc` row with plausible counts.

- [ ] **Step 6: Prove re-running is idempotent**

```bash
pnpm sync:catalogue
```

Re-run the count query. Expected: counts essentially unchanged — small drift is correct, because the catalogue is live. A doubling means the upsert is inserting instead of updating.

- [ ] **Step 7: Commit**

```bash
git add server/catalogue/cli.mts package.json .env.example
git commit -m "Add the sync:catalogue CLI entry"
```

---

### Task 6: Run the job in the container

**Files:**
- Modify: `Dockerfile`
- Modify: `CLAUDE.md`

**Why:** M1 deferred finding #5. The runtime stage copies only the standalone output, so it carries no `db/` or `server/` and cannot run the one-off jobs CLAUDE.md requires.

- [ ] **Step 1: Check what the standalone output already provides**

```bash
docker build -t games-app .
docker run --rm --entrypoint sh games-app -c "ls node_modules | head -20; ls node_modules/drizzle-orm >/dev/null 2>&1 && echo 'drizzle-orm: present' || echo 'drizzle-orm: MISSING'; ls node_modules/pg >/dev/null 2>&1 && echo 'pg: present' || echo 'pg: MISSING'; ls node_modules/zod >/dev/null 2>&1 && echo 'zod: present' || echo 'zod: MISSING'"
```

Record the result. The standalone trace should include all three because the app's routes import them. If any is missing, that dependency must be copied explicitly in the next step.

- [ ] **Step 2: Copy the job sources into the runtime stage**

In `Dockerfile`, after the existing `COPY --from=builder ... ./.next/static` line:

```dockerfile
# The standalone bundle contains only what the server needs at request time. The one-off
# catalogue and hydration jobs run from source under Node's native type stripping.
COPY --from=builder --chown=node:node /app/db ./db
COPY --from=builder --chown=node:node /app/server ./server
```

- [ ] **Step 3: Rebuild and run the job in the container**

```bash
docker build -t games-app .
sed -E 's/^([A-Z_]+)="(.*)"$/\1=\2/' .env.local > .env.docker
docker run --rm --env-file .env.docker --entrypoint node games-app \
  --conditions=react-server server/catalogue/cli.mts --since=1
```

Keep `.env.docker` — Step 4 needs it. It is covered by the `.env*` gitignore rule.

Expected: the job runs, prints a summary and exits 0. `--since=1` keeps it to one day of changes so the check is quick.

Paste the output. If a module cannot be resolved, add that package to the runtime stage rather than reverting the approach.

- [ ] **Step 4: Confirm the web path still works**

```bash
docker run -d --name games-check --env-file .env.docker -p 3002:3000 games-app
curl -s -w '\n%{http_code}\n' http://localhost:3002/api/health
docker rm -f games-check
rm -f .env.docker
```

Expected: `{"status":"ok","database":"ok"}` and `200`.

- [ ] **Step 5: Apply the CLAUDE.md amendments**

Three changes, each with a verified finding behind it (spec §3):

1. In "The constraint that shapes the architecture", replace the claim that the sync walks the list "respecting a conservative self-imposed rate limit with backoff on 429" with: `IStoreService/GetAppList` is on `api.steampowered.com`, not the storefront host; the full catalogue is 6 requests at `max_results=50000`; the storefront's ~200-per-5-minutes limit does not apply to it. Backoff still exists in the client because an unobserved limit is not an absent one.
2. Replace "Its request parameters and response shape have not been verified" with the verified shape: `response.apps[]` of `{appid, name, last_modified, price_change_number}`, `have_more_results`, and an exclusive `last_appid` cursor that the terminal page omits.
3. Add that `sync:catalogue` indexes games and DLC only, and that a 403 body is HTML rather than JSON.

- [ ] **Step 6: Full verification**

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm test:db
env -u DATABASE_URL pnpm build
```

Expected: all exit 0. Paste the output.

- [ ] **Step 7: Commit, push and open the PR**

```bash
git add Dockerfile CLAUDE.md
git commit -m "Run one-off jobs in the container and correct the sync documentation"
git push -u origin feat/m2-catalogue-sync
gh pr create --title "M2: catalogue sync" --base main \
  --body "Steam client, GetAppList parser and walker, catalogue sync with a hydration-safe upsert, the sync:catalogue CLI, and container support for one-off jobs."
gh pr checks --watch
```
