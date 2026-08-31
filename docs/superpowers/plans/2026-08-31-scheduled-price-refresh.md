# Scheduled Price Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run the existing `pnpm refresh:prices` job automatically once a month via GitHub Actions, so the deployed app's prices stop depending on someone remembering to run a CLI.

**Architecture:** One new GitHub Actions workflow file. It reuses `ci.yml`'s runner setup verbatim and invokes the unchanged `pnpm refresh:prices` script, so the scheduled run and a manual run are the same code path. No application code, schema, or dependency changes. Overlap is already prevented by Postgres advisory lock `4801002` inside `refreshPrices`; the workflow adds a `concurrency` group over the top.

**Tech Stack:** GitHub Actions, pnpm 11.24.0, Node 24, the existing `server/catalogue/prices-cli.mts` entry point.

**Spec:** `docs/superpowers/specs/2026-08-31-scheduled-price-refresh-design.md`

## Global Constraints

- Cadence is **monthly**: cron `0 3 1 * *`. Do not "helpfully" tighten it — the spec §1 records this as a deliberate portfolio-app trade.
- The only new secret is **`DATABASE_URL_UNPOOLED`**. `STEAM_API_KEY` is NOT required: `server/steam/client.ts::steamFetchJson` sends no key and the storefront `appdetails` endpoint is keyless.
- Do NOT set `STEAM_COUNTRY_CODE` or `STEAM_LANGUAGE` in the workflow. They must fall through to the `cz` / `english` defaults in `server/env.ts` so the job matches the deployed site.
- Do NOT set `DATABASE_URL` or `DB_DRIVER` in the workflow. `prices-cli.mts` copies `DATABASE_URL_UNPOOLED` into `DATABASE_URL` itself, and `resolveDriver` returns `node-postgres` on a runner because `VERCEL` is unset.
- The workflow must never `echo` its environment, print `$DATABASE_URL_UNPOOLED`, or run under `set -x`. Never commit a real connection string, and never paste one into a file or terminal output.
- No application code changes. If a task seems to need one, stop and raise it.
- Runner setup must mirror `.github/workflows/ci.yml` exactly: `actions/checkout@v4`, `pnpm/action-setup@v4`, `actions/setup-node@v4` with `node-version: 24` and `cache: pnpm`, then `pnpm install --frozen-lockfile`.
- Branch → commit → push → `gh pr create`. Nothing is pushed straight to `main`.

## File Structure

| File | Responsibility |
|---|---|
| Create: `.github/workflows/refresh-prices.yml` | The entire deliverable — schedule, manual trigger, runner setup, the one command, and the two accepted-gap comments. |
| Read only: `.github/workflows/ci.yml` | The pattern being mirrored. Not modified. |
| Read only: `server/catalogue/prices-cli.mts` | Defines the `--max-requests=N` flag shape the workflow passes. Not modified. |

One file, so there is one implementation task. Task 2 is the post-merge verification the spec §7 requires, which cannot run earlier because `schedule` and `workflow_dispatch` only fire from the default branch.

---

### Task 1: The scheduled workflow

**Files:**
- Create: `.github/workflows/refresh-prices.yml`
- Test: none — this is CI configuration, not application code. Verified by Task 2's real dispatched run, per spec §7.

**Interfaces:**
- Consumes: the `refresh:prices` script in `package.json`, which runs `node --conditions=react-server server/catalogue/prices-cli.mts`. That CLI accepts `--max-requests=<positive number>` and `--max-duration=<positive seconds>`; both are optional and unbounded when absent.
- Produces: a workflow named `Refresh prices` with a `workflow_dispatch` input `max_requests` (string, optional), which Task 2 dispatches.

- [ ] **Step 1: Read the file being mirrored**

Run: `cat .github/workflows/ci.yml`

Confirm the runner setup block matches what Step 2 reproduces. If `ci.yml` has changed (different action versions or node version), match the file as it actually is, not as this plan quotes it.

- [ ] **Step 2: Create the workflow file**

Create `.github/workflows/refresh-prices.yml` with exactly this content:

```yaml
name: Refresh prices

# Monthly, not the 6h TTL_MS.price implies: this is a portfolio app and nothing on the read
# path refreshes a stale price, so displayed prices are as old as the last run by design.
# See docs/superpowers/specs/2026-08-31-scheduled-price-refresh-design.md §1.
#
# GitHub disables scheduled workflows after 60 days without repository activity. When that
# happens the cron stops silently — re-enable it from the Actions tab.
on:
  schedule:
    - cron: '0 3 1 * *'
  workflow_dispatch:
    inputs:
      max_requests:
        description: 'Stop after N batches of 100 appids (leave blank for a full sweep)'
        required: false
        type: string

# cancel-in-progress: false queues a second workflow run behind the first rather than
# skipping or cancelling it, so both eventually execute — this only serialises two Actions
# runs against each other. It gives no protection against the realistic collision, a human
# running the CLI locally while the cron fires; that case rests entirely on advisory lock
# 4801002 inside refreshPrices.
concurrency:
  group: refresh-prices
  cancel-in-progress: false

jobs:
  refresh:
    runs-on: ubuntu-latest
    timeout-minutes: 30
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@v4
        with:
          persist-credentials: false
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - name: Refresh prices
        env:
          DATABASE_URL_UNPOOLED: ${{ secrets.DATABASE_URL_UNPOOLED }}
          MAX_REQUESTS: ${{ inputs.max_requests }}
          # STEAM_COUNTRY_CODE is deliberately left unset so it falls through to the `cz`
          # default in server/env.ts. If the Vercel deployment's default ever diverges, this
          # job keeps refreshing rows under a `cc` no page reads, and nothing detects it.
        run: |
          if [ -n "$MAX_REQUESTS" ]; then
            pnpm refresh:prices "--max-requests=$MAX_REQUESTS"
          else
            # 1500s (25min) stays under the 30min job timeout so an unbounded sweep ends
            # green with durable partial progress instead of being killed red every month.
            # Progress is durable: applyPriceBatch commits one transaction per appid and
            # stamps fetched_at, and selectStalePriceAppids orders oldest-fetched-first, so
            # the next run picks up where this one stopped.
            pnpm refresh:prices --max-duration=1500
          fi
```

Note on the `env:`/`if` shape: the dispatch input is passed through an environment variable rather than interpolated straight into the `run:` script, so a value typed into the dispatch form cannot be substituted into the shell command as code.

- [ ] **Step 3: Verify the file parses as YAML**

`js-yaml@4.3.2` is present in this repo (as a transitive dependency, under
`node_modules/.pnpm/`, not hoisted to top-level `node_modules`), so parse with it directly
rather than doing a byte/line smoke check:

```
node -e "
const yaml = require('./node_modules/.pnpm/js-yaml@4.3.2/node_modules/js-yaml');
const {readFileSync} = require('node:fs');
yaml.load(readFileSync('.github/workflows/refresh-prices.yml','utf8'));
console.log('parsed ok');
"
```

Expected: `parsed ok`, no exception. `actionlint` is genuinely absent from this repo —
`which actionlint` returns not found — so this parse is the deepest static check available
locally; GitHub validates the workflow schema itself on push, and Task 2 Step 1 confirms it
registered.

- [ ] **Step 4: Confirm no secret leaked into the file**

Run: `grep -nE 'postgres(ql)?://|npg_|password|sslmode' .github/workflows/refresh-prices.yml`

Expected: no output. Any match means a real connection string was pasted in — remove it before committing.

- [ ] **Step 5: Run the repo checks**

Run: `pnpm lint && pnpm typecheck && pnpm build`

Expected: all three pass. No file they cover was touched, so this confirms nothing regressed rather than testing the new file. Paste the actual output — do not report a result you did not run.

- [ ] **Step 6: Commit**

```bash
git add .github/workflows/refresh-prices.yml
git commit -m "Refresh prices monthly on a schedule"
```

- [ ] **Step 7: Push and open the PR**

```bash
git push -u origin docs/scheduled-price-refresh
gh pr create --fill
```

The branch already carries the spec commit (`f616f21`), so the PR contains both the design and the workflow.

---

### Task 2: Prove the scheduled path works (post-merge)

**Files:** none — this task gathers evidence, it does not change code.

**Interfaces:**
- Consumes: the `Refresh prices` workflow and its `max_requests` input from Task 1, merged to `main`.

This task CANNOT start until the PR is merged: `schedule` and `workflow_dispatch` only run from the default branch.

- [ ] **Step 1: Add the secret, then confirm the workflow registered**

The human partner adds the repository secret — the agent must not handle the connection string:

```
gh secret set DATABASE_URL_UNPOOLED
```

It prompts for the value; paste the Neon **direct** (unpooled) connection string. Do not pass it with `--body`, which would put it in shell history.

Then run: `gh secret list` and `gh workflow list`

Expected: `DATABASE_URL_UNPOOLED` appears in the secret list, and `Refresh prices` appears in the workflow list.

- [ ] **Step 2: Record the before state**

Run this against the database and keep the output:

```sql
select count(*) as rows, max(fetched_at)::text as newest from price;
```

- [ ] **Step 3: Dispatch a bounded run**

Run: `gh workflow run "Refresh prices" -f max_requests=3`

Then: `gh run watch` (or `gh run list --workflow="Refresh prices" --limit 1`)

Expected: the run completes green. Three batches is ~4 seconds of work plus install time.

- [ ] **Step 4: Read the run log**

Run: `gh run view --log` (select the run, or pass its id from `gh run list`)

Expected: a line of the form `refreshed N prices (M changed) across 3 batches in X.Xs`.

Note what the spec §4 predicts: the sweep opens with ~37 batches of appids that have no `price` row, so a 3-batch run will very likely report `refreshed 0 prices`. **That is a pass, not a failure** — it proves the job ran, reached Steam, and completed. Do not "fix" it.

- [ ] **Step 5: Prove it reached the real database**

Re-run the Step 2 query and compare.

Expected: `max(fetched_at)` has moved to the time of the dispatched run. Because `refreshPrices` stamps `fetched_at = now()` for every requested appid that already had a price row, this moves even when zero prices were written — and it is the evidence that the workflow's credentials, driver selection, and advisory lock all worked against production.

If `max(fetched_at)` did NOT move, the run touched only appids with no price row. Re-dispatch with `max_requests=45` to get past the null tail, and compare again.

- [ ] **Step 6: Dispatch an unbounded run and measure the real cost**

Neither `max_requests=3` nor `max_requests=45` exercises the path the monthly cron actually
takes — the `else` branch running `pnpm refresh:prices --max-duration=1500` with no request
cap. Exercise it once:

Run: `gh workflow run "Refresh prices"` (no `-f max_requests`, so the input is unset)

Then: `gh run watch` (or poll `gh run list --workflow="Refresh prices" --limit 1`)

Once it finishes, read `gh run view --log` and record two numbers:
- the job's real wall clock (the run duration shown by `gh run view` / the Actions UI, not
  just the in-process timer in the `refresh:prices` log line)
- the reported batch count from the `refreshed N prices (M changed) across B batches in X.Xs`
  line

This is the measurement that validates or refutes the design's `--max-duration=1500` and
`timeout-minutes: 30` choices (spec §3, §6 gap 3), not a rerun of Steps 3–5. Only ~13,515
non-free games exist in total, so a full sweep needs on the order of ~136 batches (100 appids
each) to exhaust every one of them, not the ~1,300 that 1500s ÷ 1.13s/batch would suggest — the
loop breaks on `appids.length === 0` once nothing stale is left, regardless of the time
remaining. At the §2 upper bound of ~1.13s/batch that predicts a natural finish around 150s,
far short of the 1500s cap, but that estimate has no write load in it and has never been
checked against a real full-sweep run. So the two outcomes worth distinguishing are: the run
finishes on its own well under 1500s (supports the bound as generous, maybe overly so), or it
runs meaningfully longer than ~150s — which would mean per-batch write cost, backoff, or the
NOT-IN-list growth (spec §4's named risk) is doing more than the §2 estimate accounted for, and
is the thing to investigate before trusting the bound. A run that gets killed by
`timeout-minutes` instead of stopping itself (on the duration bound or by exhausting the stale
set) means the bound was set too loose relative to the 30-minute ceiling and needs a follow-up
before the next scheduled run — do not paper over that result.

- [ ] **Step 7: Report the evidence**

State plainly which of these was observed and which was not: the green bounded run, the log
line quoted verbatim, the before/after `max(fetched_at)` values, and the unbounded run's real
wall clock and batch count from Step 6. Do not claim the monthly schedule itself fired — that
cannot be observed until the 1st of the month, and saying so is the honest report.

---

## Self-Review

**Spec coverage:**

| Spec section | Covered by |
|---|---|
| §1 scope, monthly cadence, exclusions | Global Constraints; Task 1 Step 2 comment block |
| §2 measurements | Informational; no task needed |
| §3 workflow table (schedule, dispatch input, command, timeout, concurrency) | Task 1 Step 2 — all five rows present in the YAML |
| §4 null tail accepted, not fixed | Task 2 Step 4's "that is a pass, not a failure" note |
| §5 single secret, no `STEAM_API_KEY`, no driver override, no env echo | Global Constraints; Task 1 Steps 2 and 4; Task 2 Step 1 |
| §5 rejected Vercel cron | No task by design — nothing to build |
| §6 failure gaps | Gaps 1–2 recorded as comments in the workflow (Task 1 Step 2); gaps 3–4 (unmeasured runner origin, no per-batch catch) are spec-only, accepted risks with no workflow-visible mitigation — Task 2 Step 6 is the first real observation of gap 3 |
| §7 testing and acceptance evidence | Task 1 Step 5; Task 2 Steps 2–7 |

No gaps.

**Placeholder scan:** No TBD/TODO. Every step names a command and its expected output. The one "no test" statement is justified against spec §7 rather than left implicit.

**Type consistency:** The dispatch input is `max_requests` in the YAML, in `gh workflow run -f max_requests=3`, and in Task 1's Interfaces block. The CLI flag is `--max-requests=` (hyphenated) in all three places it appears, matching `prices-cli.mts`. Lock key `4801002` matches `PRICES_LOCK_KEY` in `server/catalogue/queue.ts`.
