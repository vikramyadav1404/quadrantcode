# TraceLoop

**Don't just solve problems. Learn from where you got stuck.**

TraceLoop is a DSA accountability and _solve intelligence_ platform. It is **not** a
LeetCode clone. You solve problems on external platforms (free tier) or on TraceLoop's
own original problems (premium tier); TraceLoop records **how** the solve went — timed
sessions, run attempts, stuck points, mistake patterns, spaced revision, contest
upsolving and reminders — and turns that into a revision plan.

---

## What is built, and what is planned

Kept honest deliberately: **planned** means designed and scoped but not built,
never "quietly missing". Anything cut from the target build says so here rather
than being described in the present tense elsewhere in this file.

Target build is **18 features**. The rest are out of scope for it and would
return only if the project continued past that.

### Built

| ID    | Feature                                     | Where                         |
| ----- | ------------------------------------------- | ----------------------------- |
| F0.1  | Repository scaffold & CI                    | root, `.github/`              |
| F0.2  | Identity & problem catalog schema           | `server/db/schema/`           |
| F0.3  | Auth, phone OTP & verification tiers        | `server/services/auth/`       |
| F0.3+ | Auth UI — login, verify, onboarding         | `app/(auth)/`                 |
| F0.4  | Design system & application shell           | `components/`                 |
| F0.5  | User profile & avatar upload                | `server/services/profile/`    |
| F1.1  | Problem catalog, search & admin CRUD        | `server/services/problems/`   |
| F1.2  | CSV ingestion, export & library             | `server/services/ingest/`     |
| F1.3  | Timezone-correct streak & daily goal engine | `server/services/streak/`     |
| F1.4  | Server-authoritative solve session timer    | `server/services/session/`    |
| F1.5  | Attempt history, stuck markers & reflection | `server/services/reflection/` |
| F1.6  | Rollup-backed analytics dashboard           | `server/services/analytics/`  |
| F2.1  | Spaced repetition & forgetting-risk scoring | `server/services/revision/`   |
| F3.1  | Monaco editor & queued code execution       | `server/services/execution/`  |

### Planned — in the target build

| ID   | Feature                                | Notes                                                           |
| ---- | -------------------------------------- | --------------------------------------------------------------- |
| F3.2 | Event log & diff-based code snapshots  | Also owns the server-side code snapshot F3.1 deferred (**D24**) |
| F3.3 | Heuristic stuck-point inference        |                                                                 |
| F3.5 | Mistake memory & weak-topic engine     |                                                                 |
| F4.6 | Tracing, health dashboard & audit logs |                                                                 |
| F4.8 | Security hardening & launch readiness  |                                                                 |

### Cut from the target build

Not built, not being built. Listed so their absence is a decision on the record.

| ID    | Feature                               | What its absence means today                                                                                                                                                                                                                                                                                                                                                                                                      |
| ----- | ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1.2* | Curated 100-problem library           | A small verified subset ships; the full list is **BLOCKED** on real data. The importer and `npm run library:verify` are built                                                                                                                                                                                                                                                                                                     |
| F2.2  | Four-mode revision experience         | F2.1 ships `/revision` — the due list, in risk order, with three outcomes. The four distinct revision **modes** are cut, and nothing pretends otherwise (**D23**)                                                                                                                                                                                                                                                                 |
| F2.3  | Queue runtime & standalone worker     | **No BullMQ, no Redis queue.** Background work is in-process with state in Postgres; no automatic retry, no scheduled sweeps. F3.1 shipped under this: `execution_jobs` **is** the queue. See **D17**, **D24**                                                                                                                                                                                                                    |
| F2.4  | Multi-channel notification engine     | No reminders of any kind — it was queue-dependent                                                                                                                                                                                                                                                                                                                                                                                 |
| F2.5  | Contest sync & upsolve tracker        | No contest ingestion                                                                                                                                                                                                                                                                                                                                                                                                              |
| F4.1  | Original problem CMS & quality gate   | The schema supports original problems; there is no authoring UI, so the catalog is external links only                                                                                                                                                                                                                                                                                                                            |
| F4.2  | Structured preparation tracks         | `target_role` is captured at onboarding and unused                                                                                                                                                                                                                                                                                                                                                                                |
| F4.3  | Coin ledger, trust score & anti-abuse | **C8** has no path to guard — nothing in scope grants rewards; the constraint stands for anything added later. **If this returns: `streak_freezes` is NOT append-only.** It is a projection of current coverage, rewritten by every recompute — a backfill releases a spent freeze by design (D18). Every other ledger in this project is append-only, so auditing freeze history needs a new table, not a query against that one |
| F4.4  | Razorpay subscriptions & entitlements | No billing. **C6** (server-side entitlement checks) is unexercised                                                                                                                                                                                                                                                                                                                                                                |
| F4.5  | Timed mock assessment engine          |                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| F4.7  | Landing, public profile & share cards | No public surface; the disclaimer below still applies to anything published                                                                                                                                                                                                                                                                                                                                                       |

---

## Architecture

```
                    ┌───────────────────────────┐
   browser ────────▶│  Next.js 15 (App Router)  │
                    │  Server Components,       │
                    │  Server Actions, routes   │
                    └─────┬───────────────┬─────┘
                          │               │
                 ┌────────▼──────┐  ┌─────▼────────────┐
                 │  PostgreSQL   │  │  Redis (Upstash) │
                 │  (Supabase)   │  │  queues + limits │
                 └────────▲──────┘  └─────▲────────────┘
                          │               │
                    ┌─────┴───────────────┴─────┐
                    │  worker (not in use, D17)  │
                    │  separate deployment      │──▶ Resend / Telegram
                    └───────────────────────────┘
```

> Architecture diagram placeholder — replaced with a rendered diagram in F4.8.

**Stack (locked):** Next.js 15 App Router · TypeScript strict · Tailwind CSS +
shadcn/ui · PostgreSQL (Supabase) + Drizzle ORM with versioned SQL migrations ·
Auth.js email magic link + MSG91 phone OTP · in-process jobs with Postgres state ·
Monaco Editor · Razorpay · Resend · Telegram Bot API · Sentry + structured JSON logs.

---

## Repository layout

| Path               | Contents                                                  |
| ------------------ | --------------------------------------------------------- |
| `app/`             | Routes (App Router)                                       |
| `components/`      | UI components                                             |
| `lib/`             | Isomorphic utilities (`env.ts`, `flags.ts`, `utils.ts`)   |
| `server/`          | Server-only code — never imported from a client component |
| `server/db/`       | Drizzle schema + versioned SQL migrations                 |
| `server/services/` | Business logic, pure where possible                       |
| `jobs/`            | Empty — F2.3 is cut, see D17                              |
| `worker/`          | Standalone worker entrypoint (own package script)         |
| `tests/`           | Vitest suites                                             |
| `docs/`            | Scoring formulas, performance notes, security audit       |

### The `server/` boundary

Importing `server/**` from a client component fails **twice**, deliberately:

1. **Lint** — `no-restricted-imports` is **deny-by-default** across all files, with
   server paths (`server/`, `worker/`, `jobs/`, `scripts/`, `tests/`, and server
   components) exempted by path. Runs in the pre-commit hook and in CI.
2. **Build** — application-facing server entrypoints `import 'server-only'`, so Next.js
   fails the build if one reaches a client bundle even with the lint rule disabled.

`tests/boundary/server-boundary.test.ts` asserts both, including four bypass paths.
It exists because a guard with no regression test is not a guard — and writing it
immediately exposed that the lint rule had covered only three directories.

**Module layering.** `server-only` throws unless the `react-server` export condition is
set, which Next sets and plain Node does not. Rather than making the worker claim to be
an RSC environment, the guard is placed where it belongs:

| Module                | Guard                            | Imported by                            |
| --------------------- | -------------------------------- | -------------------------------------- |
| `server/db/client.ts` | none                             | worker, jobs, and `server/db/index.ts` |
| `server/db/index.ts`  | `import 'server-only'`           | application code                       |
| `lib/env.ts`          | none needed — public values only | anywhere, including the browser        |
| `server/env.ts`       | runtime `typeof window` check    | server code and the worker             |

The worker runs as plain `tsx worker/index.ts`. A test asserts no npm script
re-introduces `--conditions=react-server`.

---

## Local setup

```bash
cp .env.example .env.local      # Next.js app
cp .env.example .env            # worker (needs DATABASE_URL and, later, REDIS_URL)

npm install
npm run db:migrate              # applies server/db/migrations
npm run dev                     # http://localhost:3000
npm run worker                  # separate terminal — background jobs
```

Every variable in `.env.example` carries a one-line comment. Only `NODE_ENV`,
`DATABASE_URL` and `NEXT_PUBLIC_APP_URL` are required to boot; everything else is
phase-gated and fails loudly at the point of use via `requireEnv()`.

### Scripts

| Script                | Purpose                                         |
| --------------------- | ----------------------------------------------- |
| `npm run dev`         | Next.js dev server                              |
| `npm run worker`      | Standalone worker process (no queues attached)  |
| `npm run typecheck`   | `tsc --noEmit`, strict                          |
| `npm run lint`        | ESLint flat config                              |
| `npm test`            | Vitest                                          |
| `npm run db:generate` | Generate a migration from schema changes        |
| `npm run db:migrate`  | Apply migrations (uses the unpooled connection) |
| `npm run db:studio`   | Drizzle Studio                                  |

---

## Worker deployment

> **Scope note.** F2.3 (`job-runtime`) is cut, so no BullMQ worker runs today
> and `npm run worker` starts a process with no queues attached. The reasoning
> below is kept because it still governs anything long-lived this project might
> add, and because the `--conditions=react-server` finding in it is load-bearing
> (see D17 and the module-layering notes).

**A queue worker could not run on Vercel serverless.** Three independent reasons,
recorded for whatever long-lived process comes later:

1. **No long-lived process.** A BullMQ `Worker` holds an open Redis connection and
   blocks on `BRPOPLPUSH` waiting for jobs. Vercel functions are invoked per request
   and frozen or killed when the response is sent, so there is nothing to hold the
   loop open between invocations.
2. **Execution-time ceiling.** Judge0 polling, CSV imports and the monthly report job
   run for minutes. Vercel functions cap out well below that, and a killed function
   leaves a job in `active` until its lock expires.
3. **Concurrency and rate limiting are per-process.** Token buckets (Codeforces sync),
   the per-user Judge0 concurrency cap and graceful `SIGTERM` draining all assume one
   process that owns its queue. Serverless gives you N cold instances that share no
   state and receive no shutdown signal.

**Intended target:** Railway (Fly.io and Render work the same way).

```bash
# Railway
railway init
railway variables set DATABASE_URL=... REDIS_URL=... NODE_ENV=production
railway up                          # start command: npm run worker
```

The worker needs the same `.env` as the app plus `REDIS_URL`; it does **not** need any
`NEXT_PUBLIC_*` value. It exits `0` on `SIGTERM` after draining in-flight jobs, so the
platform's rolling deploy does not drop work.

---

## Feature flags

Every feature ships behind `FEATURE_*`, read through `lib/flags.ts` and **defaulting to
`false`**. A flag is flipped to `true` only once its ticket's acceptance criteria pass.
`isFeatureEnabled` treats anything other than the exact string `true` as off, so a typo
disables a feature rather than exposing it.

## Data model

Tables are introduced per phase; see `server/db/schema/`.

| Phase    | Tables                                                                                                                         |
| -------- | ------------------------------------------------------------------------------------------------------------------------------ |
| 0 (F0.2) | `users`, `user_profiles`, `verification_methods`, `problems`, `problem_tags`, `user_problems`, `daily_goals`, `daily_sessions` |

**Constraint C1 lives in the database.** `problems_external_link_no_statement`
rejects any `source_type = 'external_link'` row that carries a statement, input
or output format, constraints text, examples or an editorial — and requires
`external_url` to be present. No service bug, admin form or bulk import can get
around it. F1.1 repeats the rule in the service layer for a better error
message; the CHECK is the backstop.

**Constraint C3 likewise:** `problem_tags_company_style_suffix` rejects a
`company_style` tag that does not end in `-style`.

`users.timezone` is validated against `pg_timezone_names` by a trigger — a
CHECK cannot contain a subquery, and validating only in Zod would leave psql
and bulk imports unguarded.

Every index carries a comment naming the query it serves, and
[`docs/performance.md`](docs/performance.md) holds the pasted `EXPLAIN ANALYZE`
output proving each one is actually used.

### Testing against a real database

```bash
npm run test:db:start                  # embedded Postgres on :55432
TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:55432/traceloop_test npm test
npm run test:db:stop
```

Suites needing a database skip themselves when `TEST_DATABASE_URL` is unset, so
`npm test` stays green without one. CI always sets it from a `postgres:16`
service container, so the constraint tests genuinely run there.

### Migrations

`drizzle-kit` generates up-migrations only. Every migration has a hand-written
counterpart in `server/db/migrations/down/`, applied by `npm run db:rollback`
(add `-- all` to unwind everything). `tests/schema/migrations.test.ts` asserts
up → down → up leaves no orphaned table, enum type or function.

---

## Auth & verification (F0.3)

**Sign-in** is an Auth.js email magic link delivered by Resend, with **database
sessions** (not JWTs) so a session can actually be revoked — required by
"log out all devices" and by forced invalidation on email change. Cookies are
`httpOnly`, `SameSite=Lax` (a magic link is a top-level GET, so `Strict` would
break it) and `Secure` in production. Every sign-in rotates the session,
dropping prior ones.

**Verification levels** are _derived_, not stored authoritatively:

| Level | Meaning                               |
| ----- | ------------------------------------- |
| 0     | email only                            |
| 1     | email + phone verified                |
| 2     | level 1 + an active paid subscription |

`users.verification_level` is a cache. `computeVerificationLevel()` is the
definition and `recomputeVerificationLevel()` rebuilds the column from actual
state — it repairs drift in both directions and is idempotent.

**Phone OTP** sits behind an `OtpProvider` interface (MSG91 in production, a
console provider locally, selected by whether credentials exist rather than by
`NODE_ENV`). Codes are 6 digits, HMAC-SHA256 hashed with `AUTH_SECRET` as a
pepper, compared in constant time, and never logged. Limits:

| Rule                           | Value              | Enforced where                       |
| ------------------------------ | ------------------ | ------------------------------------ |
| Code lifetime                  | 10 minutes         | database                             |
| Verify attempts per code       | 5, then burned     | database                             |
| Code requests per phone        | 3 per rolling hour | database **and** Redis               |
| Requests per IP                | 10 per hour        | Redis                                |
| One phone → one active account | ever               | partial unique index + service check |

The durable limits live in Postgres deliberately: Redis absorbs floods cheaply,
but a Redis outage or a flushed key must not hand an attacker unlimited
attempts. The Upstash limiter **fails closed**, and refuses to fall back to the
in-process limiter in production (per-process counters would not limit anything
on serverless).

**Authorization** splits by layer, and the split is what avoids a redirect loop:

- `middleware.ts` (edge) asks only _"is there a session?"_ → redirect to sign-in.
- `app/admin/layout.tsx` (Node) asks _"is this an admin?"_ → `forbidden()`, a
  real **403**. Redirecting an already-authenticated user back to sign-in is
  exactly the loop the ticket warns about.

`getCurrentUser()` is the only session read in the codebase; it is
request-deduped with React `cache`.

## Design system (F0.4)

**Tokens** live in [`styles/tokens.css`](styles/tokens.css) as CSS variables —
`background`, `surface`, `surface-raised`, `border`, `text-primary`,
`text-muted`, `accent`, `accent-foreground`, `success`, `warning`, `danger`,
`focus-ring`. Dark is the default; light is opt-in via `data-theme="light"`,
applied by an inline script before first paint so the theme never flashes.

**No component contains a literal colour.** `tests/design/tokens.test.ts` walks
`components/` and `app/` and fails on any hex, `rgb()` or `hsl()` literal.

**Contrast is measured, not assumed.** `npm run contrast` prints the actual
WCAG ratio for all 38 token pairs and exits non-zero on any failure; the same
thresholds are asserted as tests, so a colour change that breaks accessibility
fails CI. The measured numbers are pasted into the header of `tokens.css`.

Two tokens were **changed rather than waived** after the first measurement:
`border` came in at 2.46:1 (dark) and 2.52:1 (light) against the 3:1 non-text
minimum, so both were darkened/lightened until they passed. Lowest ratios now:
body text 6.09:1, non-text 3.06:1.

**Primitives** (`components/ui/`): `PageHeader`, `StatCard`, `EmptyState`,
`DataTable`, `ConfirmDialog`, `Toast`, `Skeleton`.

`DataTable` is generic over its row type and knows **no domain entity** — it
takes `columns`, a `fetchPage` callback and a `rowKey`, and owns only
presentation, sort state and the cursor. Pagination is cursor-based, never
`OFFSET`, so pages stay stable while rows are inserted.

**Shell** (`components/shell/`): sidebar at ≥768px, bottom nav below it, top bar
with the streak badge and daily-goal ring. Every dynamic value is a **prop** —
the components never query. The layout makes one call, `summariseForShell`
(F1.3), which is why the real numbers landed without changing their shape. That
call recomputes rather than reading the stored streak, because the stored number
ages overnight and nothing is scheduled to refresh it (**D19**).

**Accessibility:** a skip link, `aria-current` on the active nav item, a visible
focus ring on every interactive element, `<dialog>` for modals (so focus
trapping and Escape come from the platform), `role="img"` with an explicit
label on the progress ring, and `aria-live` regions for toasts and table
updates.

## The day boundary (F1.3)

**A day is a day in the user's IANA timezone — never UTC, never the server's.**
Every activity resolves to a `local_date` at write time through one function,
`server/services/streak/day.ts`, and everything downstream works on
`YYYY-MM-DD` strings that came out of it. A solve at 23:59 in Kolkata belongs to
that Kolkata day even though UTC has already moved on; a solve at 23:59 in New
York belongs to that New York day even though UTC has not. Recorded days are
never re-resolved, so changing timezone affects future days only (**D18**) — the
settings page says so at the moment the field changes, because a shift can make
a date appear twice or look skipped, and correct-but-unexplained is
indistinguishable from a bug.

Two things follow that are worth knowing before touching this module:

- **`Intl` silently remaps legacy abbreviations.** `EST` resolves to
  `America/Panama`, which has no DST — a user stored that way would be an hour
  out for half the year with nothing pointing at the cause. Timezones must be
  `Area/Location` (or `UTC`); abbreviations are rejected.
- **A frozen day is not a solved day.** Both count toward the streak, only one
  is something the user did, and the heatmap renders them differently — colour
  _and_ a hatch, so it survives greyscale and colourblindness.

## The solve timer (F1.4)

**The server owns every timestamp.** The client sends intent — start, pause,
resume, finish — and never a duration or a time. There is no
`active_duration_seconds` column either: the number is computed from the event
log on every read, so the events are the record and the value is always a
function of them (**D20**).

That is what makes elapsed time survive a refresh, a closed tab, or a machine
with the wrong clock. A test forges a duration and three timestamps against every
schema and a browser posts the same forgery to the heartbeat endpoint with a real
session cookie; nothing moves, because no schema has a field to put them in.

Two consequences worth knowing before building on it:

- **A session that crosses midnight is credited to the day it ENDED.** Both local
  dates are stored, each resolved when it was written. Crediting the day the
  sitting began would let someone hold a session open across midnight to bank a
  solve for a day they did not finish.
- **There is no scheduler.** A session nobody returns to is closed by the owner's
  own next page load, or by `npm run sessions:sweep`. Six hours of silence ends a
  session, stamped at the last heartbeat rather than at the moment it was noticed
  — a user who closed their laptop stopped working when the heartbeats stopped.

## Reflection data (F1.5)

**The taxonomy is declared once**, in `lib/reflection/taxonomy.ts`, and the
Postgres enums are built from that array. The database, the form validation and
the checkboxes therefore cannot disagree about what a category is — a test
asserts `enum_range(NULL::mistake_category)` equals the array, so the generation
is proved rather than assumed (**D21**).

Every taxonomy value is an enum column or a normalised child row. The rule for
what may live in the JSONB `extras` column is short: **if anything will ever
filter, group or sort by it, it is a column instead.** Two tests hold that line
— one runs `WHERE category = 'off_by_one'` as SQL, the other asserts `extras` is
the only jsonb column across all four tables.

Two distinctions the data preserves, because everything downstream depends on
them:

- **A skipped reflection is not "nothing went wrong".** No row means the
  question was never answered; `mistakes: ['none']` means it was. Merging them
  would make every skipped question read as a clean solve.
- **A stuck marker's elapsed time is the server's**, computed from the session's
  event log like every other duration, so a marker at "12 minutes in" is
  comparable with the session total and with other sessions.

---

## Code execution (F3.1)

**There is no Judge0 instance.** Without `JUDGE0_URL`, `resolveProvider` returns
a fake that executes nothing and reports `executes: false`. The editor, the
limits, the state machine and the result panel all work; the results are not
real execution, and nothing in the code or the UI says otherwise.

`Judge0Provider` is written from the published API and is **UNVERIFIED** — it
has never run against an instance. Supplying the URL is then a configuration
change rather than a development task.

### These are configured limits, not a sandbox

Every submission carries a 2-second CPU limit, a 5-second wall-clock limit,
256 MB of memory, no network, and at most 32 KB of captured output. That is what
is **sent**. Whether it is enforced is a property of how the Judge0 instance was
deployed — its isolation, its cgroups, its network policy — none of which lives
in this repository. **Do not describe this as a secure sandbox.**

### Limits a user meets

Twenty runs per rolling hour and five concurrent, both counted in Postgres
rather than in memory, because two serverless invocations each counting their
own executions both see one. The hourly message names the time capacity returns,
computed from the oldest run still inside the window. The concurrency message
names no time, because that limit clears when a run finishes and inventing a
clock time would be a promise nothing keeps.

### An outage is never a verdict

A provider failure fails the **job** and writes no `run_attempts` row. Recording
`internal_error` would be a statement about the user's program that nothing
observed. Nothing retries — there is no queue (**D17**) — and the message says
so rather than promising a recovery that is not coming.

**Run `npm run executions:sweep` after every deploy.** A job stuck at `running`
counts against its owner's concurrency cap forever, and five of them lock that
user out of the feature entirely. The in-process runner cannot survive a deploy
mid-run, so this is not hypothetical.

### Program output is rendered, not sanitised

Output reaches the screen through React text nodes and nothing else. `<script>`
arrives intact and inert: a program that prints a tag should see the tag it
printed. `e2e/execution.spec.ts` proves it in Chromium, with a positive control
that sets the same flag deliberately on the same page first — so a CSP could not
make the test pass by making the payload impossible.

### C1 in the editor

For an external-link problem there is no statement on the page and no comparison
after a run: `expected_output` is unconditionally null, and test counts are
`null` rather than `0 / 0`, which would read as a failure rather than as "there
was nothing to check". The page says it is a scratchpad and links out.

## Verification

| Command                 | What it proves                                                                                                                      |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `npm test`              | 899 unit + integration tests, 5 skipped (Postgres-backed suites skip without `TEST_DATABASE_URL` — check the count, not the colour) |
| `npm run test:e2e`      | 68 browser tests — viewports, theme flash, auth flow, payload capture, the timer, reflection, revision, and the editor's XSS proof  |
| `npm run contrast`      | Every token pair against its WCAG threshold; exits non-zero on failure                                                              |
| `npm run test:db:start` | Embedded Postgres on :55432 for the integration suites                                                                              |

CI runs these as **two jobs**: unit/lint/build, and browser. They are separate so
Chromium flake never blocks a green typecheck.

- [`docs/acceptance-status.md`](docs/acceptance-status.md) — every Phase 0
  criterion with its evidence, including what is deferred or blocked
- [`docs/decisions.md`](docs/decisions.md) — decisions that cost something,
  with the alternative rejected and what breaks if each turns out wrong
- [`docs/performance.md`](docs/performance.md) — pasted EXPLAIN plans

## Avatar storage (F0.5)

Uploads use a **two-phase presigned flow** and the file never passes through a
Next.js route handler:

1. `POST /api/avatar/presign` — the server validates the declared type and size,
   builds the key `avatars/{userId}/{uuid}.{ext}` from the **session** user id,
   and returns a URL valid 60 seconds.
2. The browser `PUT`s **directly to storage**.
3. `POST /api/avatar/confirm` — the server verifies the object exists, that its
   real byte size matches the declaration, and that its **leading bytes are a
   real image**. Only then is `avatar_url` written, and the previous object
   deleted. Any failed check deletes the upload.

**Why not proxy the file.** Vercel caps a serverless request body at roughly
4.5MB. Proxying a 2MB upload works in development and fails unpredictably in
production once multipart overhead is added. The presigned flow is the only
shape that works, not an optimisation.

**Bucket policy.** A **dedicated `avatars` bucket, public-read**. Supabase makes
buckets public or private per _bucket_ — there is no prefix-level ACL — so
"public-read for the avatars prefix only" means a bucket containing nothing but
avatars. The service-role key is server-side only and never `NEXT_PUBLIC`.

**What is trusted:** nothing the client sends. `avatar_url` is constructed
server-side from the key; a URL in a save payload is dropped by the schema. The
accepted types are JPEG, PNG and WebP, identified by magic bytes
(`FF D8 FF`, `89 50 4E 47`, `RIFF....WEBP`) rather than by extension or the
declared MIME type. Cap 2MB, checked at both phases. Presign is rate limited to
10 per user per hour.

**Orphans.** A presign with no confirm leaves an unreferenced object;
`cleanupOrphanedAvatars` deletes avatar objects older than 24 hours that no
profile references. It is tested. With F2.3 cut nothing schedules it — run
`npm run avatars:cleanup` on demand. Orphans accumulate until you do (D17).

## Conventions

- Branch: `feat/<ID>-<slug>` · Commit: `feat(<slug>): <summary>` ·
  PR: `<ID> · <slug> — <Feature name>`
- Commit types: `feat` `fix` `refactor` `test` `chore` `docs` `perf` `security`
- TypeScript strict; `any` requires a one-line justification comment.
- Every table carries `created_at` / `updated_at`; user-data tables add `deleted_at`.
- Every index carries a comment naming the query it serves.
- Timers, streaks and countdowns are server-authoritative.
- Zod validation at every API boundary, inputs and outputs.

---

## Disclaimer

TraceLoop stores **metadata and links only** for problems hosted on external platforms —
never statements, examples, editorials or test cases. Company-style tracks are based on
common public interview patterns and original practice problems.

**This project is not affiliated with or endorsed by any company or coding platform.**
