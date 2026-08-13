# TraceLoop

**Don't just solve problems. Learn from where you got stuck.**

TraceLoop is a DSA accountability and _solve intelligence_ platform. It is **not** a
LeetCode clone. You solve problems on external platforms (free tier) or on TraceLoop's
own original problems (premium tier); TraceLoop records **how** the solve went — timed
sessions, run attempts, stuck points, mistake patterns, spaced revision, contest
upsolving and reminders — and turns that into a revision plan.

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
                    │  BullMQ worker (Railway)  │──▶ Judge0
                    │  separate deployment      │──▶ Resend / Telegram
                    └───────────────────────────┘
```

> Architecture diagram placeholder — replaced with a rendered diagram in F4.8.

**Stack (locked):** Next.js 15 App Router · TypeScript strict · Tailwind CSS +
shadcn/ui · PostgreSQL (Supabase) + Drizzle ORM with versioned SQL migrations ·
Auth.js email magic link + MSG91 phone OTP · BullMQ + Upstash Redis · Judge0 ·
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
| `jobs/`            | BullMQ processors                                         |
| `worker/`          | Standalone worker entrypoint (own package script)         |
| `tests/`           | Vitest suites                                             |
| `docs/`            | Scoring formulas, performance notes, security audit       |

### The `server/` boundary

Importing `server/**` from a client component fails **twice**, deliberately:

1. **Lint** — `no-restricted-imports` in `eslint.config.mjs` blocks the import from
   `components/`, `lib/` and client files under `app/`, with a message pointing at the
   fix. This runs in the pre-commit hook and in CI.
2. **Build** — server entrypoints `import 'server-only'`, so Next.js fails the build if
   one reaches a client bundle even with the lint rule disabled.

`lib/env.ts` deliberately does _not_ import `server-only`: that package throws unless
the `react-server` export condition is set, which the standalone worker (plain Node)
does not have. It guards itself with an explicit `typeof window` check instead, and the
worker scripts run with `--conditions=react-server` so `server-only` resolves to a no-op
there.

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
| `npm run worker`      | Standalone BullMQ worker (independent process)  |
| `npm run typecheck`   | `tsc --noEmit`, strict                          |
| `npm run lint`        | ESLint flat config                              |
| `npm test`            | Vitest                                          |
| `npm run db:generate` | Generate a migration from schema changes        |
| `npm run db:migrate`  | Apply migrations (uses the unpooled connection) |
| `npm run db:studio`   | Drizzle Studio                                  |

---

## Worker deployment

**The BullMQ worker cannot run on Vercel serverless.** Three independent reasons:

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
