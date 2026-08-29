# M1 — Deployable Skeleton Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a deployed, signed-in-capable games-db skeleton on Vercel — schema, auth, macOS app shell, health check, container — with no Steam data, so the live domain can be used to register the Steam Web API key that everything after M1 depends on.

**Architecture:** Next.js App Router with server components by default. One database module (`db/client.ts`) selects the Neon serverless driver on Vercel and a `node-postgres` Pool elsewhere; it is constructed lazily because `next build` evaluates route modules with no `DATABASE_URL` present. Auth.js v5 holds sessions in that same database via the Drizzle adapter. The UI is a macOS-style sidebar-and-toolbar shell with light and dark themes driven by CSS custom properties.

**Tech Stack:** Next.js 16.3.3, React 19.2.8, TypeScript 5, Tailwind CSS 4, Drizzle ORM 0.45.2 + Drizzle Kit 0.31.10, Neon Postgres, Auth.js `next-auth@5.0.0-beta.32` + `@auth/drizzle-adapter@1.11.3`, Zod 4, Vitest 4, Playwright 1.62, pnpm 11, Node 24.

**Spec:** `docs/superpowers/specs/2026-08-29-games-db-design.md`

## Global Constraints

- Package manager is **pnpm**; Node **24**. `packageManager: "pnpm@11.24.0"`.
- **Auth.js v5 is `next-auth@5.0.0-beta.32`.** npm's `latest` tag for `next-auth` is `4.24.15` — installing `latest` gets you v4, whose API differs completely. Pin the exact beta.
- **No Steam calls anywhere in M1.** The health endpoint must never touch Steam.
- **No Vercel-only APIs in application code** — the container path must keep working.
- `db/schema.ts` is the only place tables are defined; `db/client.ts` is the only place a client is constructed (CLAUDE.md, "Data layer").
- Migrations are an explicit step, never run on container start.
- Never print, log, or commit connection strings or secrets. `.env.local` is gitignored.
- Comments only where they record something the code cannot say (CLAUDE.md, "No unnecessary comments"). Do not add JSDoc that repeats a signature.
- Currency is never assumed — always read from the response. Country code default `cz`, which returns **EUR** (spec §1.2).
- Every task ends with a commit. Every PR-boundary marker (`🔀`) means: push the branch and open a PR with `gh pr create`, then branch off `main` again for the next task once merged.
- Definition of done per CLAUDE.md: `pnpm build`, `pnpm lint`, `pnpm typecheck` pass **with pasted output**, the path is exercised, and you state plainly what you verified and what you did not.

## File Structure

| Path | Responsibility |
|---|---|
| `package.json`, `pnpm-workspace.yaml` | Dependencies, scripts, pinned package manager |
| `tsconfig.json`, `eslint.config.mjs`, `postcss.config.mjs` | Language and lint config |
| `next.config.ts` | Standalone output (container only), image remote patterns |
| `vitest.config.ts` | Unit test config, `next-auth` inline workaround |
| `vitest.db.config.ts` | Integration tests that touch a real database |
| `drizzle.config.ts` | Points Drizzle Kit at `db/schema.ts` → `db/migrations` |
| `db/schema.ts` | Every table definition |
| `db/client.ts` | Driver selection and the single lazy client |
| `db/migrations/` | Generated SQL, committed |
| `server/auth/config.ts` | Auth.js instance, adapter wiring |
| `server/auth/session.ts` | Session projection (no PII beyond name/email/image) |
| `server/auth/actions.ts` | `signInAction` / `signOutAction` server actions |
| `server/env.ts` | Zod-validated environment access |
| `app/layout.tsx`, `app/globals.css` | Root layout, design tokens, theme |
| `app/page.tsx` | Discover placeholder inside the shell |
| `app/signin/page.tsx` | Sign-in page |
| `app/api/health/route.ts` | Health check — database only, never Steam |
| `app/api/auth/[...nextauth]/route.ts` | Auth.js route handlers |
| `components/app-shell.tsx` | Sidebar + toolbar + content frame |
| `components/sidebar.tsx` | macOS source list |
| `components/toolbar.tsx` | Toolbar with search slot and account control |
| `components/theme-toggle.tsx` | Client component, light/dark/system |
| `lib/theme.ts` | Pure theme resolution logic (unit tested) |
| `tests/` | Vitest unit + integration tests |
| `e2e/` | Playwright specs |
| `Dockerfile`, `.dockerignore` | Container build |
| `.github/workflows/ci.yml` | lint, typecheck, test, build |

---

## Task 1: Project scaffold and test harness

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `tsconfig.json`, `next.config.ts`, `postcss.config.mjs`, `eslint.config.mjs`, `vitest.config.ts`, `.env.example`, `app/layout.tsx`, `app/globals.css`, `app/page.tsx`, `lib/theme.ts`
- Test: `tests/theme.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `resolveTheme(stored: string | null, systemPrefersDark: boolean): 'light' | 'dark'` from `lib/theme.ts`; the `@/*` path alias resolving to the repo root.

Do **not** run `create-next-app` — the directory already holds `CLAUDE.md`, `LICENSE`, `docs/` and `.gitignore`, and the generator will fight them. Write these files directly.

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "games-db",
  "version": "0.1.0",
  "private": true,
  "packageManager": "pnpm@11.24.0",
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "eslint",
    "typecheck": "next typegen && tsc --noEmit",
    "test": "vitest run",
    "test:db": "vitest run --config vitest.db.config.ts",
    "test:e2e": "playwright test",
    "db:generate": "drizzle-kit generate",
    "db:migrate": "drizzle-kit migrate",
    "db:studio": "drizzle-kit studio"
  },
  "dependencies": {
    "@auth/drizzle-adapter": "1.11.3",
    "@neondatabase/serverless": "^1.1.0",
    "drizzle-orm": "^0.45.2",
    "next": "16.3.3",
    "next-auth": "5.0.0-beta.32",
    "pg": "^8.23.0",
    "react": "19.2.8",
    "react-dom": "19.2.8",
    "server-only": "^0.0.1",
    "zod": "^4.5.4"
  },
  "devDependencies": {
    "@eslint/eslintrc": "^3",
    "@playwright/test": "^1.62.1",
    "@tailwindcss/postcss": "^4",
    "@types/node": "^20",
    "@types/pg": "^8.23.1",
    "@types/react": "^19",
    "@types/react-dom": "^19",
    "drizzle-kit": "^0.31.10",
    "eslint": "^9",
    "eslint-config-next": "16.3.3",
    "tailwindcss": "^4",
    "typescript": "^5",
    "vitest": "^4.1.11"
  }
}
```

- [ ] **Step 2: Create the remaining config files**

`pnpm-workspace.yaml` — pnpm 11 requires build scripts to be approved explicitly:

```yaml
onlyBuiltDependencies:
  - '@tailwindcss/oxide'
  - esbuild
  - sharp
```

`tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2017",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "react-jsx",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./*"] }
  },
  "include": [
    "next-env.d.ts",
    "**/*.ts",
    "**/*.tsx",
    ".next/types/**/*.ts",
    ".next/dev/types/**/*.ts",
    "**/*.mts"
  ],
  "exclude": ["node_modules", "e2e"]
}
```

`next.config.ts` — the comment records a real Vercel/standalone conflict, keep it:

```typescript
import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // Vercel traces the output itself, and its onBuildComplete hook fails on the missing
  // next-server.js.nft.json that 'standalone' leaves behind. The container build needs
  // 'standalone' to exist, so the two targets get different values.
  output: process.env.VERCEL ? undefined : 'standalone',
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '**.akamai.steamstatic.com' },
    ],
  },
}

export default nextConfig
```

`postcss.config.mjs`:

```javascript
const config = { plugins: { '@tailwindcss/postcss': {} } }
export default config
```

`eslint.config.mjs`:

```javascript
import { FlatCompat } from '@eslint/eslintrc'

const compat = new FlatCompat({ baseDirectory: import.meta.dirname })

export default [
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
  { ignores: ['.next/**', 'node_modules/**', 'db/migrations/**'] },
]
```

`vitest.config.ts` — both workarounds below are real and were hit on the sibling project:

```typescript
import path from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    exclude: ['**/node_modules/**', 'tests/db-integration/**'],
    // next-auth imports 'next/server', and the next package ships no exports map, so Node's
    // ESM resolver cannot resolve the extensionless subpath. Letting Vite transform next-auth
    // instead of externalising it puts the import through a resolver that can.
    server: { deps: { inline: ['next-auth'] } },
  },
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, '.'),
      // The server-only package resolves to a module that throws unless the react-server
      // export condition is active, which it is not under vitest.
      'server-only': path.resolve(import.meta.dirname, 'tests/stubs/server-only.ts'),
    },
  },
})
```

`.env.example` — names only, never values:

```
DATABASE_URL=
DATABASE_URL_UNPOOLED=
AUTH_SECRET=
AUTH_GITHUB_ID=
AUTH_GITHUB_SECRET=
AUTH_URL=
STEAM_COUNTRY_CODE=cz
```

`tests/stubs/server-only.ts`:

```typescript
export {}
```

- [ ] **Step 3: Write the failing test**

`tests/theme.test.ts`:

```typescript
import { describe, expect, it } from 'vitest'
import { resolveTheme } from '@/lib/theme'

describe('resolveTheme', () => {
  it('honours an explicit stored light preference over a dark system', () => {
    expect(resolveTheme('light', true)).toBe('light')
  })

  it('honours an explicit stored dark preference over a light system', () => {
    expect(resolveTheme('dark', false)).toBe('dark')
  })

  it('falls back to the system preference when nothing is stored', () => {
    expect(resolveTheme(null, true)).toBe('dark')
    expect(resolveTheme(null, false)).toBe('light')
  })

  it('treats an unrecognised stored value as no preference', () => {
    expect(resolveTheme('chartreuse', true)).toBe('dark')
  })

  it('treats the explicit "system" value as no preference', () => {
    expect(resolveTheme('system', false)).toBe('light')
  })
})
```

- [ ] **Step 4: Install dependencies and run the test to verify it fails**

```bash
pnpm install
pnpm test
```

Expected: FAIL — `Failed to resolve import "@/lib/theme"`.

- [ ] **Step 5: Write the minimal implementation**

`lib/theme.ts`:

```typescript
export type Theme = 'light' | 'dark'

export function resolveTheme(stored: string | null, systemPrefersDark: boolean): Theme {
  if (stored === 'light' || stored === 'dark') return stored
  return systemPrefersDark ? 'dark' : 'light'
}
```

- [ ] **Step 6: Run the test to verify it passes**

```bash
pnpm test
```

Expected: PASS, 5 tests.

- [ ] **Step 7: Create the minimal app so `next build` has routes**

`app/globals.css` — the full token set, light first, both dark selectors:

```css
@import 'tailwindcss';

:root {
  --bg: #ffffff;
  --bg-chrome: #f6f6f6;
  --bg-sidebar: #eceaea;
  --bg-panel: #f5f5f7;
  --text: #1d1d1f;
  --text-dim: #86868b;
  --line: rgba(0, 0, 0, 0.11);
  --accent: #0a74f0;
  --positive: #0a8f3c;
  color-scheme: light;
}

:root:not([data-theme='light']) {
  @media (prefers-color-scheme: dark) {
    --bg: #1c1c1e;
    --bg-chrome: #252528;
    --bg-sidebar: #232326;
    --bg-panel: #252528;
    --text: #f2f2f7;
    --text-dim: #98989f;
    --line: rgba(255, 255, 255, 0.1);
    --accent: #0a84ff;
    --positive: #30d158;
    color-scheme: dark;
  }
}

:root[data-theme='dark'] {
  --bg: #1c1c1e;
  --bg-chrome: #252528;
  --bg-sidebar: #232326;
  --bg-panel: #252528;
  --text: #f2f2f7;
  --text-dim: #98989f;
  --line: rgba(255, 255, 255, 0.1);
  --accent: #0a84ff;
  --positive: #30d158;
  color-scheme: dark;
}

@theme inline {
  --color-bg: var(--bg);
  --color-bg-chrome: var(--bg-chrome);
  --color-bg-sidebar: var(--bg-sidebar);
  --color-bg-panel: var(--bg-panel);
  --color-text: var(--text);
  --color-text-dim: var(--text-dim);
  --color-line: var(--line);
  --color-accent: var(--accent);
  --color-positive: var(--positive);
  --font-sans: -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Helvetica Neue', Arial,
    sans-serif;
}

body {
  background: var(--bg);
  color: var(--text);
}

@layer base {
  button:not(:disabled),
  [role='button']:not(:disabled) {
    cursor: pointer;
  }
}
```

`app/layout.tsx`:

```tsx
import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Games',
  description: 'A personal PC games catalogue built on Steam store data.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full font-sans text-[13px]">{children}</body>
    </html>
  )
}
```

`app/page.tsx`:

```tsx
export default function DiscoverPage() {
  return <main className="p-6">Discover</main>
}
```

- [ ] **Step 8: Verify lint, typecheck and build all pass**

```bash
pnpm lint && pnpm typecheck && pnpm build
```

Expected: all three succeed. Paste the output. `next build` must succeed **without** any `DATABASE_URL` set — that property is load-bearing for the Docker build and is re-checked in Task 3.

- [ ] **Step 9: Commit**

```bash
git checkout -b feat/m1-scaffold
git add -A
git commit -m "Scaffold Next.js app with Tailwind, Vitest and theme tokens"
```

---

## Task 2: Continuous integration

**Files:**
- Create: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: the `lint`, `typecheck`, `test`, `build` scripts from Task 1.
- Produces: a required status check on every pull request.

- [ ] **Step 1: Write the workflow**

`.github/workflows/ci.yml`:

```yaml
name: CI

on:
  pull_request:
  push:
    branches: [main]

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm lint
      - run: pnpm typecheck
      - run: pnpm test
      - run: pnpm build
```

No `DATABASE_URL` secret is provided here on purpose: if `pnpm build` ever starts needing one, CI fails and tells us the lazy-client contract has been broken.

- [ ] **Step 2: Commit, push and open the first PR** 🔀

```bash
git add .github/workflows/ci.yml
git commit -m "Add CI workflow running lint, typecheck, test and build"
git push -u origin feat/m1-scaffold
gh pr create --title "M1: project scaffold, theme tokens and CI" --base main \
  --body "Scaffolds the Next.js app, Tailwind v4 token set with light and dark, the Vitest harness, and CI. No database or auth yet."
```

- [ ] **Step 3: Confirm CI is green before continuing**

```bash
gh pr checks --watch
```

Expected: all checks pass. Merge, then `git checkout main && git pull` before Task 3.

---

## Task 3: Database client and driver selection

**Files:**
- Create: `db/client.ts`, `db/schema.ts` (placeholder export only), `drizzle.config.ts`, `server/env.ts`
- Test: `tests/db/client.test.ts`, `tests/env.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `resolveDriver(env: Record<string, string | undefined>): 'neon-http' | 'node-postgres'`
  - `getDb(): Db` where `Db = Omit<NodePgDatabase<typeof schema>, 'transaction'>`
  - `serverEnv(): { databaseUrl: string; steamCountryCode: string }` from `server/env.ts`

- [ ] **Step 1: Write the failing tests**

`tests/db/client.test.ts`:

```typescript
import { describe, expect, it } from 'vitest'
import { resolveDriver } from '@/db/client'

describe('resolveDriver', () => {
  it('uses the Neon serverless driver on Vercel', () => {
    expect(resolveDriver({ VERCEL: '1' })).toBe('neon-http')
  })

  it('uses a node-postgres pool everywhere else', () => {
    expect(resolveDriver({})).toBe('node-postgres')
  })

  it('lets DB_DRIVER override the runtime guess', () => {
    expect(resolveDriver({ VERCEL: '1', DB_DRIVER: 'node-postgres' })).toBe('node-postgres')
  })

  it('rejects an unknown DB_DRIVER rather than silently guessing', () => {
    expect(() => resolveDriver({ DB_DRIVER: 'mysql' })).toThrow(/Unsupported DB_DRIVER/)
  })
})
```

`tests/env.test.ts`:

```typescript
import { describe, expect, it } from 'vitest'
import { parseServerEnv } from '@/server/env'

describe('parseServerEnv', () => {
  it('defaults the country code to cz', () => {
    expect(parseServerEnv({ DATABASE_URL: 'postgres://x' }).steamCountryCode).toBe('cz')
  })

  it('accepts an explicit country code', () => {
    const env = parseServerEnv({ DATABASE_URL: 'postgres://x', STEAM_COUNTRY_CODE: 'pl' })
    expect(env.steamCountryCode).toBe('pl')
  })

  it('fails loudly when DATABASE_URL is missing', () => {
    expect(() => parseServerEnv({})).toThrow(/DATABASE_URL/)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
pnpm test
```

Expected: FAIL — cannot resolve `@/db/client` and `@/server/env`.

- [ ] **Step 3: Write the implementations**

`server/env.ts`:

```typescript
import { z } from 'zod'

const schema = z.object({
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is not set'),
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
```

`db/schema.ts` — a placeholder so the client compiles; Task 4 fills it in:

```typescript
export {}
```

`db/client.ts`:

```typescript
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
```

`drizzle.config.ts`:

```typescript
import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  dialect: 'postgresql',
  schema: './db/schema.ts',
  out: './db/migrations',
  dbCredentials: { url: process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL! },
})
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
pnpm test
```

Expected: PASS, 12 tests total.

- [ ] **Step 5: Prove the build still needs no database**

```bash
env -u DATABASE_URL pnpm build
```

Expected: build succeeds. If it fails with "DATABASE_URL is not set", something imported `getDb()` at module scope — fix that rather than adding the variable to the build.

- [ ] **Step 6: Commit**

```bash
git checkout -b feat/m1-database
git add db/ server/env.ts drizzle.config.ts tests/
git commit -m "Add lazy database client with runtime driver selection"
```

---

## Task 4: Schema and first migration

**Files:**
- Modify: `db/schema.ts` (replace the placeholder)
- Create: `db/migrations/` (generated), `tests/db/schema.test.ts`, `vitest.db.config.ts`, `tests/db-integration/migrate.test.ts`

**Interfaces:**
- Consumes: `Db` and `getDb()` from Task 3.
- Produces: table objects `users`, `accounts`, `sessions`, `verificationTokens`, `steamApp`, `game`, `gameMedia`, `genre`, `gameGenre`, `category`, `gameCategory`, `price`, `priceHistory`, `reviewSummary`, `libraryEntry`, `libraryStatusEvent`, and the enums `hydrationState`, `libraryStatus`, `mediaKind`.

- [ ] **Step 1: Write the schema**

`db/schema.ts`:

```typescript
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  real,
  smallint,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core'

export const hydrationState = pgEnum('hydration_state', [
  'pending',
  'ok',
  'failed',
  'unavailable',
])

export const libraryStatus = pgEnum('library_status', [
  'backlog',
  'playing',
  'finished',
  'abandoned',
  'wishlist',
])

export const mediaKind = pgEnum('media_kind', ['screenshot', 'movie'])

export const users = pgTable('users', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text('name'),
  email: text('email').unique(),
  emailVerified: timestamp('email_verified', { mode: 'date', withTimezone: true }),
  image: text('image'),
})

export const accounts = pgTable(
  'accounts',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    provider: text('provider').notNull(),
    providerAccountId: text('provider_account_id').notNull(),
    refresh_token: text('refresh_token'),
    access_token: text('access_token'),
    expires_at: integer('expires_at'),
    token_type: text('token_type'),
    scope: text('scope'),
    id_token: text('id_token'),
    session_state: text('session_state'),
  },
  (t) => [primaryKey({ columns: [t.provider, t.providerAccountId] })],
)

export const sessions = pgTable('sessions', {
  sessionToken: text('session_token').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  expires: timestamp('expires', { mode: 'date', withTimezone: true }).notNull(),
})

export const verificationTokens = pgTable(
  'verification_tokens',
  {
    identifier: text('identifier').notNull(),
    token: text('token').notNull(),
    expires: timestamp('expires', { mode: 'date', withTimezone: true }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.identifier, t.token] })],
)

export const steamApp = pgTable(
  'steam_app',
  {
    appid: integer('appid').primaryKey(),
    name: text('name').notNull(),
    appType: text('app_type'),
    lastSeenInListAt: timestamp('last_seen_in_list_at', { withTimezone: true }),
    hydrationState: hydrationState('hydration_state').notNull().default('pending'),
    failureCount: integer('failure_count').notNull().default(0),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }),
  },
  (t) => [index('steam_app_queue_idx').on(t.hydrationState, t.nextAttemptAt)],
)

export const game = pgTable(
  'game',
  {
    appid: integer('appid')
      .primaryKey()
      .references(() => steamApp.appid, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    type: text('type').notNull(),
    isFree: boolean('is_free').notNull().default(false),
    shortDescription: text('short_description'),
    aboutHtml: text('about_html'),
    detailedHtml: text('detailed_html'),
    headerImage: text('header_image'),
    capsuleImage: text('capsule_image'),
    backgroundRaw: text('background_raw'),
    releaseDateText: text('release_date_text'),
    releaseComingSoon: boolean('release_coming_soon').notNull().default(false),
    releaseDate: timestamp('release_date', { withTimezone: true }),
    developers: text('developers').array(),
    publishers: text('publishers').array(),
    platforms: jsonb('platforms'),
    metacriticScore: smallint('metacritic_score'),
    metacriticUrl: text('metacritic_url'),
    recommendationsTotal: integer('recommendations_total'),
    achievementsTotal: integer('achievements_total'),
    supportedLanguagesRaw: text('supported_languages_raw'),
    contentDescriptorIds: integer('content_descriptor_ids').array(),
    contentDescriptorNotes: text('content_descriptor_notes'),
    dlcAppids: integer('dlc_appids').array(),
    pcRequirements: jsonb('pc_requirements'),
    macRequirements: jsonb('mac_requirements'),
    linuxRequirements: jsonb('linux_requirements'),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('game_type_idx').on(t.type),
    index('game_release_date_idx').on(t.releaseDate),
    index('game_name_idx').on(t.name),
  ],
)

export const gameMedia = pgTable(
  'game_media',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    appid: integer('appid')
      .notNull()
      .references(() => game.appid, { onDelete: 'cascade' }),
    kind: mediaKind('kind').notNull(),
    position: integer('position').notNull(),
    steamMediaId: integer('steam_media_id'),
    name: text('name'),
    thumbnailUrl: text('thumbnail_url'),
    fullUrl: text('full_url'),
    hlsUrl: text('hls_url'),
    dashH264Url: text('dash_h264_url'),
    dashAv1Url: text('dash_av1_url'),
    highlight: boolean('highlight').notNull().default(false),
  },
  (t) => [index('game_media_appid_idx').on(t.appid, t.kind, t.position)],
)

export const genre = pgTable('genre', {
  id: text('id').primaryKey(),
  description: text('description').notNull(),
})

export const gameGenre = pgTable(
  'game_genre',
  {
    appid: integer('appid')
      .notNull()
      .references(() => game.appid, { onDelete: 'cascade' }),
    genreId: text('genre_id')
      .notNull()
      .references(() => genre.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.appid, t.genreId] }), index('game_genre_genre_idx').on(t.genreId)],
)

export const category = pgTable('category', {
  id: integer('id').primaryKey(),
  description: text('description').notNull(),
})

export const gameCategory = pgTable(
  'game_category',
  {
    appid: integer('appid')
      .notNull()
      .references(() => game.appid, { onDelete: 'cascade' }),
    categoryId: integer('category_id')
      .notNull()
      .references(() => category.id, { onDelete: 'cascade' }),
  },
  (t) => [
    primaryKey({ columns: [t.appid, t.categoryId] }),
    index('game_category_category_idx').on(t.categoryId),
  ],
)

// Amounts are Steam's minor-unit integers. `currency` is stored per row because cc=cz
// returns EUR, not CZK — never infer the currency from the country code.
export const price = pgTable(
  'price',
  {
    appid: integer('appid')
      .notNull()
      .references(() => game.appid, { onDelete: 'cascade' }),
    cc: text('cc').notNull(),
    currency: text('currency').notNull(),
    initialMinor: integer('initial_minor').notNull(),
    finalMinor: integer('final_minor').notNull(),
    discountPercent: smallint('discount_percent').notNull().default(0),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.appid, t.cc] }),
    index('price_discount_idx').on(t.cc, t.discountPercent),
    index('price_final_idx').on(t.cc, t.finalMinor),
  ],
)

export const priceHistory = pgTable(
  'price_history',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    appid: integer('appid')
      .notNull()
      .references(() => game.appid, { onDelete: 'cascade' }),
    cc: text('cc').notNull(),
    currency: text('currency').notNull(),
    initialMinor: integer('initial_minor').notNull(),
    finalMinor: integer('final_minor').notNull(),
    discountPercent: smallint('discount_percent').notNull().default(0),
    observedAt: timestamp('observed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('price_history_appid_idx').on(t.appid, t.cc, t.observedAt)],
)

// Aggregates only. Review bodies and author identifiers are never fetched or stored —
// they are personal data we have no way to expire when a user deletes their review.
export const reviewSummary = pgTable('review_summary', {
  appid: integer('appid')
    .primaryKey()
    .references(() => game.appid, { onDelete: 'cascade' }),
  reviewScore: smallint('review_score'),
  reviewScoreDesc: text('review_score_desc'),
  totalPositive: integer('total_positive'),
  totalNegative: integer('total_negative'),
  totalReviews: integer('total_reviews'),
  fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
})

export const libraryEntry = pgTable(
  'library_entry',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    appid: integer('appid').notNull(),
    status: libraryStatus('status').notNull(),
    addedAt: timestamp('added_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    priceSeenMinor: integer('price_seen_minor'),
    priceSeenCurrency: text('price_seen_currency'),
  },
  (t) => [
    uniqueIndex('library_entry_user_app_idx').on(t.userId, t.appid),
    index('library_entry_status_idx').on(t.userId, t.status),
  ],
)

export const libraryStatusEvent = pgTable(
  'library_status_event',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    entryId: text('entry_id')
      .notNull()
      .references(() => libraryEntry.id, { onDelete: 'cascade' }),
    status: libraryStatus('status').notNull(),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('library_status_event_entry_idx').on(t.entryId, t.at)],
)
```

`libraryEntry.appid` deliberately has no foreign key to `game`: a user may wishlist an appid before the hydration job has reached it.

- [ ] **Step 2: Write the failing schema test**

`tests/db/schema.test.ts`:

```typescript
import { getTableConfig } from 'drizzle-orm/pg-core'
import { describe, expect, it } from 'vitest'
import { libraryEntry, libraryStatus, price, reviewSummary } from '@/db/schema'

describe('schema', () => {
  it('offers exactly the five library statuses from the spec', () => {
    expect(libraryStatus.enumValues).toEqual([
      'backlog',
      'playing',
      'finished',
      'abandoned',
      'wishlist',
    ])
  })

  it('stores the currency alongside every price, since cc=cz returns EUR', () => {
    const columns = getTableConfig(price).columns.map((c) => c.name)
    expect(columns).toContain('currency')
    expect(columns).toContain('final_minor')
    expect(columns).toContain('initial_minor')
  })

  it('records the price seen when a library entry was added', () => {
    const columns = getTableConfig(libraryEntry).columns.map((c) => c.name)
    expect(columns).toContain('price_seen_minor')
    expect(columns).toContain('price_seen_currency')
  })

  it('keeps no column that could hold review text or a reviewer identity', () => {
    const columns = getTableConfig(reviewSummary).columns.map((c) => c.name)
    expect(columns).not.toContain('review')
    expect(columns).not.toContain('author_steamid')
    expect(columns).not.toContain('personaname')
  })
})
```

- [ ] **Step 3: Run the tests**

```bash
pnpm test
```

Expected: PASS, 16 tests total. If the enum assertion fails, fix `db/schema.ts` — the spec's five statuses are fixed.

- [ ] **Step 4: Generate the migration**

```bash
pnpm db:generate
```

Expected: a new folder under `db/migrations/` containing `0000_*.sql`. Read the generated SQL and confirm it creates the three enums and sixteen tables. Do not hand-edit it.

- [ ] **Step 5: Provision Neon and apply the migration**

This step needs the human. In the Vercel dashboard for the project, add a Neon database via **Storage → Create Database → Neon**; Vercel injects `DATABASE_URL` and `DATABASE_URL_UNPOOLED`. Then:

```bash
vercel link
vercel env pull .env.local
pnpm db:migrate
```

Expected: Drizzle Kit reports the migration applied. `.env.local` is gitignored — never print its contents.

- [ ] **Step 6: Prove the tables exist in the real database**

`vitest.db.config.ts`:

```typescript
import path from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/db-integration/**/*.test.ts'],
    fileParallelism: false,
  },
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, '.'),
      'server-only': path.resolve(import.meta.dirname, 'tests/stubs/server-only.ts'),
    },
  },
})
```

`tests/db-integration/migrate.test.ts`:

```typescript
import { sql } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { getDb } from '@/db/client'

describe('applied migration', () => {
  it('has created every table the schema declares', async () => {
    const rows = await getDb().execute<{ table_name: string }>(
      sql`select table_name from information_schema.tables where table_schema = 'public'`,
    )
    const names = rows.rows.map((r) => r.table_name)
    for (const expected of [
      'users',
      'accounts',
      'sessions',
      'verification_tokens',
      'steam_app',
      'game',
      'game_media',
      'genre',
      'game_genre',
      'category',
      'game_category',
      'price',
      'price_history',
      'review_summary',
      'library_entry',
      'library_status_event',
    ]) {
      expect(names).toContain(expected)
    }
  })

  it('enforces the library status enum', async () => {
    const rows = await getDb().execute<{ enumlabel: string }>(
      sql`select enumlabel from pg_enum e
          join pg_type t on t.oid = e.enumtypid
          where t.typname = 'library_status' order by e.enumsortorder`,
    )
    expect(rows.rows.map((r) => r.enumlabel)).toEqual([
      'backlog',
      'playing',
      'finished',
      'abandoned',
      'wishlist',
    ])
  })
})
```

Run it against the real database:

```bash
pnpm test:db
```

Expected: PASS. **Paste the output** — CLAUDE.md requires a query run against a real database before claiming one works.

- [ ] **Step 7: Commit, push and open the PR** 🔀

```bash
git add db/ tests/ vitest.db.config.ts
git commit -m "Add full schema, first migration and integration test"
git push -u origin feat/m1-database
gh pr create --title "M1: database client, schema and first migration" --base main \
  --body "Adds the lazy dual-driver client, the complete schema, the generated migration, and an integration test that verifies the tables and enums exist in the real Neon database."
gh pr checks --watch
```

Merge, then `git checkout main && git pull` before Task 5.

---

## Task 5: GitHub authentication

**Files:**
- Create: `server/auth/config.ts`, `server/auth/session.ts`, `server/auth/actions.ts`, `app/api/auth/[...nextauth]/route.ts`, `app/signin/page.tsx`
- Test: `tests/auth/session.test.ts`, `tests/auth/config.test.ts`

**Interfaces:**
- Consumes: `getDb()` from Task 3; `users`, `accounts`, `sessions` from Task 4.
- Produces: `handlers`, `auth`, `signIn`, `signOut` from `server/auth/config.ts`; `signInAction()` and `signOutAction()` from `server/auth/actions.ts`; `projectSession(user, expires)` from `server/auth/session.ts`.

Register the GitHub OAuth app first at <https://github.com/settings/developers>. For local work use `http://localhost:3000` as the homepage and `http://localhost:3000/api/auth/callback/github` as the callback. A second OAuth app (or a second callback URL) is added for the deployed domain in Task 8. Generate the secret with `npx auth secret` or `openssl rand -base64 32`, and put `AUTH_SECRET`, `AUTH_GITHUB_ID`, `AUTH_GITHUB_SECRET` in `.env.local` — never in a tracked file.

- [ ] **Step 1: Write the failing tests**

`tests/auth/session.test.ts`:

```typescript
import { describe, expect, it } from 'vitest'
import { projectSession } from '@/server/auth/session'

describe('projectSession', () => {
  const expires = new Date('2026-09-30T00:00:00Z')

  it('exposes only the fields the UI needs', () => {
    const session = projectSession(
      { id: 'u1', name: 'Ada', email: 'ada@example.com', image: 'https://img/1', emailVerified: null },
      expires,
    )
    expect(session.user).toEqual({
      id: 'u1',
      name: 'Ada',
      email: 'ada@example.com',
      image: 'https://img/1',
    })
  })

  it('carries the expiry through unchanged', () => {
    const session = projectSession(
      { id: 'u1', name: null, email: null, image: null, emailVerified: null },
      expires,
    )
    expect(session.expires).toBe(expires)
  })
})
```

`tests/auth/config.test.ts`:

```typescript
import { describe, expect, it } from 'vitest'

describe('auth config', () => {
  it('exports the App Router handlers', async () => {
    const mod = await import('@/server/auth/config')
    expect(typeof mod.handlers.GET).toBe('function')
    expect(typeof mod.handlers.POST).toBe('function')
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
pnpm test
```

Expected: FAIL — cannot resolve `@/server/auth/session`.

- [ ] **Step 3: Write the implementations**

`server/auth/session.ts`:

```typescript
import type { Session } from 'next-auth'

type AdapterUserLike = {
  id: string
  name: string | null
  email: string | null
  image: string | null
  emailVerified: Date | null
}

export function projectSession(user: AdapterUserLike, expires: Session['expires']): Session {
  return {
    user: { id: user.id, name: user.name, email: user.email, image: user.image },
    expires,
  } as Session
}
```

`server/auth/config.ts`:

```typescript
import 'server-only'
import { DrizzleAdapter } from '@auth/drizzle-adapter'
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core'
import NextAuth from 'next-auth'
import GitHub from 'next-auth/providers/github'
import { getDb } from '@/db/client'
import { accounts, sessions, users } from '@/db/schema'
import { projectSession } from './session'

// next build evaluates route modules while collecting page data, so building the adapter at
// module scope would construct a database client during a build that has no DATABASE_URL.
export const { handlers, auth, signIn, signOut } = NextAuth(() => ({
  adapter: DrizzleAdapter(
    // Db omits `transaction` because neon-http cannot offer one; the adapter's parameter type
    // requires it but its Postgres implementation never calls it.
    getDb() as unknown as PgDatabase<PgQueryResultHKT, Record<string, never>>,
    { usersTable: users, accountsTable: accounts, sessionsTable: sessions },
  ),
  session: { strategy: 'database' },
  providers: [GitHub],
  pages: { signIn: '/signin' },
  callbacks: {
    session({ session, user }) {
      return projectSession(user, session.expires)
    },
  },
}))
```

`server/auth/actions.ts`:

```typescript
'use server'
import { signIn, signOut } from './config'

export async function signInAction() {
  await signIn('github', { redirectTo: '/' })
}

export async function signOutAction() {
  await signOut({ redirectTo: '/' })
}
```

`app/api/auth/[...nextauth]/route.ts`:

```typescript
import { handlers } from '@/server/auth/config'

export const { GET, POST } = handlers
```

`app/signin/page.tsx`:

```tsx
import { signInAction } from '@/server/auth/actions'

export default function SignInPage() {
  return (
    <main className="flex min-h-dvh items-center justify-center p-6">
      <div className="w-full max-w-sm rounded-xl border border-line bg-bg-panel p-6">
        <h1 className="text-base font-semibold">Sign in to Games</h1>
        <p className="mt-1 text-text-dim">
          Your library and wishlist are tied to your account.
        </p>
        <form action={signInAction} className="mt-5">
          <button
            type="submit"
            className="w-full rounded-md bg-accent px-3 py-2 font-medium text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            Continue with GitHub
          </button>
        </form>
      </div>
    </main>
  )
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
pnpm test
```

Expected: PASS, 19 tests total.

- [ ] **Step 5: Exercise sign-in for real**

```bash
pnpm dev
```

Open <http://localhost:3000/signin>, complete the GitHub flow, and confirm you land back on `/`. Then confirm the session actually persisted to the database:

```bash
pnpm db:studio
```

Check that `users`, `accounts` and `sessions` each gained a row. **State plainly in your report whether you completed this manual step.** Do not claim sign-in works without it.

- [ ] **Step 6: Commit, push and open the PR** 🔀

```bash
git checkout -b feat/m1-auth
git add server/auth app/api app/signin tests/auth
git commit -m "Add GitHub sign-in with database sessions"
git push -u origin feat/m1-auth
gh pr create --title "M1: GitHub authentication" --base main \
  --body "Auth.js v5 with the GitHub provider and Drizzle adapter, database session strategy, sign-in page and server actions."
gh pr checks --watch
```

---

## Task 6: macOS app shell

**Files:**
- Create: `components/app-shell.tsx`, `components/sidebar.tsx`, `components/toolbar.tsx`, `components/theme-toggle.tsx`
- Modify: `app/layout.tsx`, `app/page.tsx`

**Interfaces:**
- Consumes: `resolveTheme` from Task 1; `auth` and `signOutAction` from Task 5.
- Produces: `<AppShell>{children}</AppShell>` wrapping every page below the root layout.

- [ ] **Step 1: Add the theme script to the root layout**

The script must run before paint, or the page flashes the wrong theme. Modify `app/layout.tsx`:

```tsx
import type { Metadata } from 'next'
import { AppShell } from '@/components/app-shell'
import './globals.css'

export const metadata: Metadata = {
  title: 'Games',
  description: 'A personal PC games catalogue built on Steam store data.',
}

// Runs before first paint so an explicit choice never flashes the system theme first.
const themeScript = `
try {
  var t = localStorage.getItem('theme')
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t
} catch {}
`

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full antialiased">
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-full font-sans text-[13px]">
        <AppShell>{children}</AppShell>
      </body>
    </html>
  )
}
```

This is the one permitted use of `dangerouslySetInnerHTML` in the codebase: the content is a constant defined here, never Steam data. CLAUDE.md's prohibition is about Steam's marketing HTML.

- [ ] **Step 2: Write the sidebar**

`components/sidebar.tsx`:

```tsx
import Link from 'next/link'

const sections = [
  {
    label: 'Library',
    items: [
      { href: '/library', name: 'All Games' },
      { href: '/library?status=playing', name: 'Playing' },
      { href: '/library?status=backlog', name: 'Backlog' },
      { href: '/library?status=finished', name: 'Finished' },
      { href: '/library?status=wishlist', name: 'Wishlist' },
    ],
  },
  {
    label: 'Store',
    items: [
      { href: '/', name: 'Discover' },
      { href: '/specials', name: 'Specials' },
      { href: '/coming-soon', name: 'Coming Soon' },
      { href: '/new-releases', name: 'New Releases' },
    ],
  },
]

export function Sidebar() {
  return (
    <nav
      aria-label="Sections"
      className="w-[200px] shrink-0 border-r border-line bg-bg-sidebar p-2"
    >
      {sections.map((section) => (
        <div key={section.label} className="mb-3">
          <h2 className="px-2 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-text-dim">
            {section.label}
          </h2>
          <ul>
            {section.items.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className="block rounded-md px-2 py-1 hover:bg-black/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent dark:hover:bg-white/10"
                >
                  {item.name}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  )
}
```

Routes beyond `/` do not exist yet; they arrive in M4 and M6. Links to them are correct now and will resolve then.

- [ ] **Step 3: Write the theme toggle**

`components/theme-toggle.tsx`:

```tsx
'use client'
import { useEffect, useState } from 'react'
import { resolveTheme, type Theme } from '@/lib/theme'

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>('light')

  useEffect(() => {
    const stored = localStorage.getItem('theme')
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
    setTheme(resolveTheme(stored, prefersDark))
  }, [])

  function toggle() {
    const next: Theme = theme === 'dark' ? 'light' : 'dark'
    setTheme(next)
    document.documentElement.dataset.theme = next
    try {
      localStorage.setItem('theme', next)
    } catch {}
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} appearance`}
      className="rounded-md border border-line px-2 py-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
    >
      {theme === 'dark' ? 'Light' : 'Dark'}
    </button>
  )
}
```

- [ ] **Step 4: Write the toolbar and shell**

`components/toolbar.tsx`:

```tsx
import Link from 'next/link'
import { ThemeToggle } from '@/components/theme-toggle'
import { signOutAction } from '@/server/auth/actions'
import { auth } from '@/server/auth/config'

export async function Toolbar() {
  const session = await auth()

  return (
    <header className="flex h-11 items-center gap-3 border-b border-line bg-bg-chrome px-3">
      <span className="font-semibold tracking-tight">Games</span>
      <div className="ml-auto flex items-center gap-3">
        <ThemeToggle />
        {session?.user ? (
          <>
            <span className="text-text-dim">{session.user.name ?? session.user.email}</span>
            <form action={signOutAction}>
              <button
                type="submit"
                className="rounded-md border border-line px-2 py-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
              >
                Sign out
              </button>
            </form>
          </>
        ) : (
          <Link
            href="/signin"
            className="rounded-md border border-line px-2 py-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
          >
            Sign in
          </Link>
        )}
      </div>
    </header>
  )
}
```

`components/app-shell.tsx`:

```tsx
import { Sidebar } from '@/components/sidebar'
import { Toolbar } from '@/components/toolbar'

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Toolbar />
        <main className="flex-1">{children}</main>
      </div>
    </div>
  )
}
```

- [ ] **Step 5: Verify build, lint and typecheck**

```bash
pnpm lint && pnpm typecheck && pnpm build
```

Expected: all pass. Paste the output.

- [ ] **Step 6: Check both themes and keyboard access by hand**

Run `pnpm dev`, then confirm: the toggle switches themes and survives a reload; Tab reaches every sidebar link, the toggle and the sign-in control with a visible focus ring; the sidebar has an accessible name ("Sections"). Report what you actually checked.

- [ ] **Step 7: Commit, push and open the PR** 🔀

```bash
git checkout -b feat/m1-shell
git add components app/layout.tsx app/page.tsx
git commit -m "Add macOS-style app shell with sidebar, toolbar and theme toggle"
git push -u origin feat/m1-shell
gh pr create --title "M1: macOS app shell with light and dark themes" --base main \
  --body "Sidebar source list, toolbar with account control and theme toggle, and a pre-paint theme script that prevents a flash of the wrong appearance."
gh pr checks --watch
```

---

## Task 7: Health endpoint

**Files:**
- Create: `app/api/health/route.ts`, `lib/health.ts`
- Test: `tests/health.test.ts`

**Interfaces:**
- Consumes: `getDb()` from Task 3.
- Produces: `checkHealth(probe: () => Promise<unknown>): Promise<{ status: 'ok' | 'degraded'; database: 'ok' | 'unavailable' }>`

- [ ] **Step 1: Write the failing test**

`tests/health.test.ts`:

```typescript
import { describe, expect, it } from 'vitest'
import { checkHealth } from '@/lib/health'

describe('checkHealth', () => {
  it('reports ok when the database answers', async () => {
    expect(await checkHealth(async () => 1)).toEqual({ status: 'ok', database: 'ok' })
  })

  it('reports degraded rather than throwing when the database is unreachable', async () => {
    const result = await checkHealth(async () => {
      throw new Error('connection refused')
    })
    expect(result).toEqual({ status: 'degraded', database: 'unavailable' })
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm test
```

Expected: FAIL — cannot resolve `@/lib/health`.

- [ ] **Step 3: Write the implementation**

`lib/health.ts`:

```typescript
export type HealthReport = {
  status: 'ok' | 'degraded'
  database: 'ok' | 'unavailable'
}

export async function checkHealth(probe: () => Promise<unknown>): Promise<HealthReport> {
  try {
    await probe()
    return { status: 'ok', database: 'ok' }
  } catch {
    return { status: 'degraded', database: 'unavailable' }
  }
}
```

`app/api/health/route.ts` — this endpoint must never touch Steam:

```typescript
import { sql } from 'drizzle-orm'
import { getDb } from '@/db/client'
import { checkHealth } from '@/lib/health'

export const dynamic = 'force-dynamic'

export async function GET() {
  const report = await checkHealth(() => getDb().execute(sql`select 1`))
  return Response.json(report, { status: report.status === 'ok' ? 200 : 503 })
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
pnpm test
```

Expected: PASS, 21 tests total.

- [ ] **Step 5: Exercise the endpoint**

```bash
pnpm dev
curl -s -w '\n%{http_code}\n' http://localhost:3000/api/health
```

Expected: `{"status":"ok","database":"ok"}` and `200`. Paste the real output.

- [ ] **Step 6: Commit**

```bash
git checkout -b feat/m1-deploy
git add app/api/health lib/health.ts tests/health.test.ts
git commit -m "Add health endpoint that checks the database and never calls Steam"
```

---

## Task 8: Container, deploy, and the Steam key

**Files:**
- Create: `Dockerfile`, `.dockerignore`, `e2e/smoke.spec.ts`, `playwright.config.ts`
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: everything above.
- Produces: a running container and a deployed Vercel URL.

- [ ] **Step 1: Write the container files**

`.dockerignore`:

```
node_modules
.next
.git
.github
.env*
docs
e2e
tests
.superpowers
```

`Dockerfile`:

```dockerfile
FROM node:24-slim AS deps
WORKDIR /app
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable pnpm
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
# unrs-resolver (eslint-only) has an unapproved build script and pnpm exits 1 on it, so
# --ignore-scripts is required. It also suppresses esbuild's approved build, which is
# harmless: next build does not use the native binary.
RUN pnpm install --frozen-lockfile --ignore-scripts

FROM node:24-slim AS builder
WORKDIR /app
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable pnpm
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm build

FROM node:24-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

RUN apt-get update && apt-get install -y --no-install-recommends curl \
  && rm -rf /var/lib/apt/lists/*

COPY --from=builder --chown=node:node /app/public ./public
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -fsS "http://127.0.0.1:${PORT}/api/health" || exit 1

CMD ["node", "server.js"]
```

Create an empty `public/.gitkeep` so the `COPY public` layer cannot fail.

- [ ] **Step 2: Build and run the container**

```bash
docker build -t games-app .
docker run --rm --env-file .env.local -p 3000:3000 games-app
```

In another shell:

```bash
curl -s -w '\n%{http_code}\n' http://localhost:3000/api/health
docker inspect --format '{{.Config.User}}' games-app
```

Expected: a healthy JSON response with `200`, and the user `node` — not root. Paste both outputs.

- [ ] **Step 3: Add the Playwright smoke test**

`playwright.config.ts`:

```typescript
import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  use: { baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000' },
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : { command: 'pnpm dev', url: 'http://localhost:3000', reuseExistingServer: true },
})
```

`e2e/smoke.spec.ts`:

```typescript
import { expect, test } from '@playwright/test'

test('health endpoint reports the database is reachable', async ({ request }) => {
  const res = await request.get('/api/health')
  expect(res.status()).toBe(200)
  expect(await res.json()).toEqual({ status: 'ok', database: 'ok' })
})

test('shell renders and the sign-in control is reachable', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('navigation', { name: 'Sections' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Sign in' })).toBeVisible()
})

test('theme choice survives a reload', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: /Switch to dark appearance/ }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
})
```

Run it:

```bash
pnpm exec playwright install chromium
pnpm test:e2e
```

Expected: 3 passed. Paste the output.

- [ ] **Step 4: Deploy to Vercel**

```bash
vercel link
vercel git connect
```

Push the branch and merge the PR so `main` deploys. Then read back the production URL:

```bash
vercel project ls
vercel inspect --wait
```

Set the remaining environment variables in the Vercel dashboard (or `vercel env add`): `AUTH_SECRET`, `AUTH_GITHUB_ID`, `AUTH_GITHUB_SECRET`, `AUTH_URL` (the production URL), `STEAM_COUNTRY_CODE=cz`. `DATABASE_URL` and `DATABASE_URL_UNPOOLED` were injected by the Neon integration in Task 4.

Add the deployed callback URL to the GitHub OAuth app: `https://<domain>/api/auth/callback/github`.

- [ ] **Step 5: Verify the deployment**

```bash
curl -s -w '\n%{http_code}\n' https://<domain>/api/health
E2E_BASE_URL=https://<domain> pnpm test:e2e
```

Expected: `200` with `{"status":"ok","database":"ok"}`, and the Playwright specs passing against production. Then sign in through the deployed site by hand and confirm a new `sessions` row. Paste the curl output and state plainly whether you completed the manual sign-in.

- [ ] **Step 6: Apply the CLAUDE.md amendments**

Make the nine changes listed in §5 of the spec. Each one has a verified finding behind it:

1. "Netflix-style browsing UI: hero banner, horizontally scrolling rows" → macOS App Store style: sidebar, toolbar, featured hero, card grids, no carousels.
2. "we use `cc=cz` so the app shows CZK" → `cc=cz` returns EUR; read `price_overview.currency` from the response and never infer it.
3. `STEAM_API_KEY` "only if a Web API method we use requires one" → required; `IStoreService/GetAppList` returns 403 without it.
4. Add the approved dependency list: Vitest, Zod, `@auth/drizzle-adapter`, Playwright, hls.js, isomorphic-dompurify.
5. Add the working agreement: every increment is branch → commit → push → PR; nothing lands directly on `main`.
6. Add: image URLs are read from payloads, never constructed — capsule paths contain per-app hashes.
7. Add: only `filters=price_overview` accepts multiple appids; `filters=basic` and bare multi-appid requests return a `null` body.
8. Replace the `ISteamApps/GetAppList` sync description with `IStoreService/GetAppList`, noting its shape is still unverified.
9. Add the review-data policy: aggregates only, fetched with `num_per_page=0&purchase_type=all`; review bodies and author identifiers are never fetched, stored, or rendered.

- [ ] **Step 7: Commit, push and open the final M1 PR** 🔀

```bash
git add Dockerfile .dockerignore playwright.config.ts e2e public/.gitkeep CLAUDE.md
git commit -m "Add container build, deploy smoke tests and CLAUDE.md corrections"
git push -u origin feat/m1-deploy
gh pr create --title "M1: container, deployment and CLAUDE.md corrections" --base main \
  --body "Multi-stage Dockerfile running as non-root with a health check, Playwright smoke tests runnable against local or production, and the nine CLAUDE.md amendments the verified Steam findings require."
gh pr checks --watch
```

- [ ] **Step 8: Hand off the domain**

Report the deployed URL to the human and stop. They register the Steam Web API key at <https://steamcommunity.com/dev/apikey> using that domain, then add `STEAM_API_KEY` to Vercel and `.env.local`.

M2 cannot start before that key exists: `IStoreService/GetAppList` returns 403 without it, and its request and response shapes are still unverified (spec §1.9). The first act of M2 is to call it with the real key and record what actually comes back.

---

## Self-Review

**Spec coverage.** M1's scope in spec §4 is: Next.js + TypeScript + Tailwind (Task 1), full schema and migration applied to real Neon (Task 4), GitHub sign-in (Task 5), macOS shell with light/dark (Task 6), `/api/health` touching the database but never Steam (Task 7), multi-stage non-root Dockerfile (Task 8), CI (Task 2), Vercel deploy (Task 8). All eight are covered. Spec §5's CLAUDE.md amendments are Task 8 Step 6. The privacy decision from §1.7 is enforced structurally by the schema test in Task 4 Step 2.

**Deliberately out of scope**, per the spec's milestone split: the Steam client, limiter, TTL config, jobs, browse, detail page, and library mutations. `hls.js` and `isomorphic-dompurify` are approved but not installed until M5 and M3 respectively — installing them now would be unused weight.

**Placeholder scan.** No TBD or "handle errors appropriately" steps; every code step carries the actual code. The two steps that genuinely need a human (Neon provisioning in Task 4 Step 5, GitHub OAuth registration before Task 5) say so explicitly rather than hiding it.

**Type consistency.** `Db` is defined once in Task 3 and consumed unchanged in Tasks 5 and 7. `resolveTheme` has the same signature in Task 1 and Task 6. `checkHealth`'s probe parameter matches its call site. `projectSession(user, expires)` matches its use in the session callback. Table identifiers used by the adapter in Task 5 (`users`, `accounts`, `sessions`) match Task 4's exports.

**One risk worth naming.** Task 1 asserts `pnpm build` succeeds with no `DATABASE_URL`, and Task 3 Step 5 re-checks it after the client exists. That property is what makes both the Docker build and the CI job work without secrets. If it ever breaks, the fix is to remove the module-scope database access, not to add the variable.
