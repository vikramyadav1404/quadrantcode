# File map

_Generated 2026-08-19 from `git ls-files` + untracked non-ignored files._

**247 files** — 241 tracked, 6 untracked (all F1.3, marked `NEW`). Excludes
`node_modules/`, `.next/`, and `package-lock.json`.

Purposes below are taken from each file's own header comment where it has one,
not inferred from its name. Files with no header are described from their
contents.

> **This document is a snapshot and will rot.** It is accurate to commit
> `dfa8aab` plus the uncommitted F1.3 work. Regenerate the list with
> `git ls-files; git ls-files --others --exclude-standard`, and re-check the
> description of anything that moved. Nothing enforces that this file matches
> the tree.

`M` = modified, uncommitted · `NEW` = untracked

---

## Root

| File                                   | Purpose                                                                                                                                                                                                 |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.env.example`                         | Every env var with a comment; `tests/boundary/env-example.test.ts` enforces the comment rule                                                                                                            |
| `.gitignore`                           | Excludes `CLAUDE.md`, `docs/prompt-pack.md`, `.env`, build output                                                                                                                                       |
| `.gitleaks.toml`                       | Secret-scanning config and allowlist                                                                                                                                                                    |
| `.prettierignore` / `.prettierrc.json` | Formatter scope and settings                                                                                                                                                                            |
| `README.md`                            | Public-facing doc; carries the built/planned/cut table and the F1.3 day-boundary rule (line 358)                                                                                                        |
| `components.json`                      | shadcn/ui generator config                                                                                                                                                                              |
| `drizzle.config.ts`                    | Drizzle Kit config — schema location, migration output dir                                                                                                                                              |
| `eslint.config.mjs`                    | Flat config, including the **deny-by-default client/server boundary rule**                                                                                                                              |
| `middleware.ts`                        | Edge middleware — **authentication only**, no authorisation                                                                                                                                             |
| `next.config.ts`                       | Next.js config                                                                                                                                                                                          |
| `package.json`                         | 25 scripts: `dev`, `build`, `test`, `test:db:start/stop`, `test:e2e`, `db:generate/migrate/rollback/seed/studio/explain`, `contrast`, `worker`, `avatars:cleanup`, `library:verify`, `db:backfill:urls` |
| `playwright.config.ts`                 | E2E runner config                                                                                                                                                                                       |
| `postcss.config.mjs`                   | Tailwind/PostCSS pipeline                                                                                                                                                                               |
| `tsconfig.json`                        | TypeScript strict config and path aliases                                                                                                                                                               |
| `vitest.config.ts`                     | Unit/integration runner config                                                                                                                                                                          |

## `.github/` · `.husky/`

| File                       | Purpose                                                 |
| -------------------------- | ------------------------------------------------------- |
| `.github/workflows/ci.yml` | CI pipeline — lint, typecheck, test, contrast, gitleaks |
| `.husky/pre-commit`        | Pre-commit hook (format + lint staged files)            |

---

## `app/` — routes (45 files)

### Authenticated shell — `app/(app)/`

| File                               | Purpose                                                              |
| ---------------------------------- | -------------------------------------------------------------------- |
| `layout.tsx` **M**                 | Authenticated application shell (F0.4)                               |
| `dashboard/page.tsx`               | Placeholder dashboard; F1.6 fills it with real numbers               |
| `dashboard/loading.tsx`            | Renders `StatGridSkeleton` while the dashboard loads                 |
| `problems/page.tsx`                | Problem catalog list                                                 |
| `problems/loading.tsx`             | Skeleton for the catalog list                                        |
| `problems/[slug]/page.tsx`         | Problem detail                                                       |
| `settings/goals/page.tsx`          | F1.3 · daily goal, timezone, and the activity heatmap                |
| `settings/goals/GoalsForm.tsx`     | Daily-goal settings form, including timezone                         |
| `settings/goals/actions.ts`        | Server actions for daily-goal settings                               |
| `settings/import/page.tsx`         | F1.2 · bring a list in, take your data out                           |
| `settings/import/ImportPanel.tsx`  | Import a CSV: choose → preview → confirm → progress                  |
| `settings/profile/page.tsx`        | Profile settings; loads via `getProfile` behind `requireCurrentUser` |
| `settings/profile/ProfileForm.tsx` | Profile form with an **optimistic** save                             |
| `settings/profile/actions.ts`      | Profile save — thin adapter: session check, then the service         |

### Signed-out — `app/(auth)/`

| File                            | Purpose                                                               |
| ------------------------------- | --------------------------------------------------------------------- |
| `layout.tsx`                    | Signed-out layout, deliberately distinct from the authenticated shell |
| `login/page.tsx`                | `/login` — one page for sign-in and sign-up                           |
| `login/LoginForm.tsx`           | Sign-in form: idle → sending → sent                                   |
| `login/actions.ts`              | The **one** entry point for sending a magic link                      |
| `login/verify/page.tsx`         | The four magic-link states, each with its own remedy                  |
| `login/verify/ResendPanel.tsx`  | Resend from a failed-link page                                        |
| `onboarding/page.tsx`           | Shown once, after first sign-in, before the dashboard                 |
| `onboarding/OnboardingForm.tsx` | Display name, timezone, target role                                   |
| `onboarding/actions.ts`         | Writes through F0.5's `updateProfile` — same path as the profile page |

### Admin — `app/admin/`

| File                           | Purpose                                                                   |
| ------------------------------ | ------------------------------------------------------------------------- |
| `layout.tsx`                   | Admin **authorisation boundary**                                          |
| `page.tsx`                     | Admin landing                                                             |
| `problems/page.tsx`            | Admin catalog — shows archived and unpublished rows the public list hides |
| `problems/NewProblemForm.tsx`  | Admin create form                                                         |
| `problems/ProblemAdminRow.tsx` | One catalog row with its archive toggle                                   |
| `problems/actions.ts`          | Admin server actions                                                      |

### API routes — `app/api/`

| File                          | Purpose                                                                     |
| ----------------------------- | --------------------------------------------------------------------------- |
| `auth/[...nextauth]/route.ts` | Auth.js route handlers; everything else goes through `server/services/auth` |
| `avatar/presign/route.ts`     | `POST` — avatar upload phase A (presign)                                    |
| `avatar/confirm/route.ts`     | `POST` — avatar upload phase B (confirm)                                    |
| `ingest/import/route.ts`      | `POST` — upload a CSV                                                       |
| `ingest/export/route.ts`      | `GET` — the user's tracked list as CSV                                      |
| `ingest/jobs/[id]/route.ts`   | `GET` — import progress                                                     |
| `otp/request/route.ts`        | `POST` — issue a phone verification code                                    |
| `otp/verify/route.ts`         | `POST` — submit a phone verification code                                   |

### Root-level app files

| File                      | Purpose                                                                     |
| ------------------------- | --------------------------------------------------------------------------- |
| `layout.tsx`              | Root layout, metadata, global CSS import                                    |
| `page.tsx`                | Placeholder root route — **F4.7 would have replaced this, and F4.7 is cut** |
| `globals.css`             | Global stylesheet                                                           |
| `error.tsx`               | Typed root error boundary                                                   |
| `forbidden.tsx`           | Rendered with HTTP 403 by `forbidden()`                                     |
| `unauthorized.tsx`        | Rendered with HTTP 401 by `unauthorized()`                                  |
| `settings/phone/page.tsx` | Phone verification settings                                                 |
| `sign-in/page.tsx`        | Legacy route — renamed to `/login` by the F0.3 amendment                    |

---

## `components/` (19 files)

| File                               | Purpose                                                              |
| ---------------------------------- | -------------------------------------------------------------------- |
| `auth/PhoneVerificationForm.tsx`   | Minimal functional OTP form (F0.3)                                   |
| `avatar/Avatar.tsx`                | Avatar with a deterministic initials fallback                        |
| `avatar/AvatarUploader.tsx`        | Three-step upload: prepare → presign → PUT → confirm                 |
| `avatar/prepare-image.ts`          | Client-side square crop → downscale → WebP                           |
| `heatmap/Heatmap.tsx`              | GitHub-style 365-day contribution heatmap                            |
| `shell/Sidebar.tsx`                | Primary navigation, hidden below 768px                               |
| `shell/BottomNav.tsx`              | Shown under 768px only, where the sidebar is hidden                  |
| `shell/nav-items.ts`               | Single source of truth for navigation — both navs share it           |
| `shell/TopBar.tsx` **M**           | Top bar: avatar, goal ring, streak badge, theme toggle               |
| `shell/StreakBadge.tsx`            | Takes its value as a **prop** — F0.4 forbids it querying             |
| `shell/GoalProgressRing.tsx` **M** | Daily-goal ring, pure presentation over props                        |
| `shell/ThemeToggle.tsx`            | Writes `data-theme` on `<html>` and persists the choice              |
| `ui/ConfirmDialog.tsx`             | Built on `<dialog>` for free focus trapping and Escape-to-close      |
| `ui/DataTable.tsx`                 | Generic, cursor-paginated, sortable table                            |
| `ui/EmptyState.tsx`                | Shown instead of an empty table — never a blank panel                |
| `ui/PageHeader.tsx`                | Title + optional description and actions; every page starts with one |
| `ui/Skeleton.tsx`                  | Shimmer placeholder; every list and card shape has one (F0.4)        |
| `ui/StatCard.tsx`                  | Stat tile with `neutral` / `success` / `warning` / `danger` tones    |
| `ui/Toast.tsx`                     | Minimal toast system                                                 |

---

## `lib/` — client-safe shared code (11 files)

| File                      | Purpose                                                               |
| ------------------------- | --------------------------------------------------------------------- |
| `env.ts`                  | **Shared** environment — public values only, safe in a client bundle  |
| `flags.ts`                | Feature flags (F0.1 requirement 4)                                    |
| `utils.ts`                | Class-name merge helper expected by shadcn/ui primitives              |
| `contrast.ts`             | WCAG 2.1 relative luminance and contrast ratio                        |
| `design-tokens.ts`        | Token values in TypeScript, so they can be **measured**               |
| `auth/mask-email.ts`      | Masks an address for the "check your email" panel                     |
| `auth/pathname-header.ts` | The header middleware uses to tell server components the current path |
| `auth/return-to.ts`       | `returnTo` validation — an open redirect here is a real finding       |
| `problems/schemas.ts`     | Zod schemas for the catalog — one schema, two consumers               |
| `profile/schemas.ts`      | Profile schemas, isomorphic, importable from a Client Component       |
| `streak/heatmap-day.ts`   | The heatmap cell contract, in the client-safe layer                   |

---

## `server/db/` (35 files)

| File          | Purpose                                                                       |
| ------------- | ----------------------------------------------------------------------------- |
| `client.ts`   | Database connection — **no `server-only` guard**, so the worker can import it |
| `index.ts`    | Application-facing entrypoint; carries `import 'server-only'`                 |
| `migrate.ts`  | Migration runner; uses the **direct, non-pooled** connection (pgbouncer)      |
| `rollback.ts` | Rollback runner over the hand-written down migrations                         |

### `server/db/schema/` — 8 files

| File          | Purpose                                                          |
| ------------- | ---------------------------------------------------------------- |
| `index.ts`    | Barrel — a table missing here is invisible to `drizzle-kit`      |
| `enums.ts`    | 11 shared Postgres enums                                         |
| `users.ts`    | Identity: users, profiles, verification methods                  |
| `auth.ts`     | Auth.js persistence: accounts, sessions, verification tokens     |
| `problems.ts` | Problem catalog — **holds the C1 and C3 CHECK constraints**      |
| `tracking.ts` | Per-user tracking: `userProblems`, `dailyGoals`, `dailySessions` |
| `streak.ts`   | F1.3 · `userStreaks`, `streakFreezes`                            |
| `ingest.ts`   | F1.2 · `importJobs`, `importJobRows`                             |

### `server/db/migrations/` — 31 files

Ten forward migrations, each with a **hand-written** down migration in `down/`
and a Drizzle snapshot in `meta/` — 1:1, same numbering.

| Migration                              | Purpose                                                                        |
| -------------------------------------- | ------------------------------------------------------------------------------ |
| `0000_core_schema.sql`                 | Users, profiles, problems, tags, tracking tables                               |
| `0001_triggers.sql`                    | Triggers — incl. **IANA timezone validation** (a CHECK cannot hold a subquery) |
| `0002_auth_tables.sql`                 | Auth.js tables                                                                 |
| `0003_problem_search.sql`              | Full-text search index for titles                                              |
| `0004_catalog_recent_index.sql`        | Index serving the catalog's default recent ordering                            |
| `0005_profile_fields.sql`              | F0.5 profile and avatar columns                                                |
| `0006_verification_token_consumed.sql` | Single-use magic links                                                         |
| `0007_import_jobs.sql`                 | F1.2 job state machine                                                         |
| `0008_import_job_content.sql`          | Stores job payload in the DB — fixed the `enqueue(jobId)` seam                 |
| `0009_streak_state.sql`                | F1.3 streak state and freeze coverage                                          |

Plus `down/0000–0009_*.down.sql` (10), `meta/0000–0009_snapshot.json` (10),
and `meta/_journal.json`.

---

## `server/` — services and runtime (54 files)

| File                 | Purpose                                                           |
| -------------------- | ----------------------------------------------------------------- |
| `env.ts`             | **Server** environment — secrets; runtime `typeof window` guard   |
| `lib/ratelimit.ts`   | Fixed-window limiter; memory + Upstash impls, `RATE_LIMITS` table |
| `services/README.md` | Business logic modules; route handlers stay thin adapters         |

### `server/services/auth/` — 7 files

| File                    | Purpose                                                                  |
| ----------------------- | ------------------------------------------------------------------------ |
| `config.ts`             | Auth.js configuration, `MAGIC_LINK_TTL_SECONDS`                          |
| `adapter.ts`            | `@auth/drizzle-adapter` plus three app rules                             |
| `session.ts`            | `getCurrentUser()` — the single read every authz check goes through      |
| `rbac.ts`               | Roles, `requireRole`, typed `AuthenticationError` / `AuthorizationError` |
| `verification-level.ts` | Verification tiers and recomputation                                     |
| `otp.ts`                | Phone OTP business rules: TTL, attempt caps, hourly caps, lockout        |
| `verify-link.ts`        | Magic-link state inspection — **read only**                              |

### `server/services/problems/` — 5 files

| File           | Purpose                                                         |
| -------------- | --------------------------------------------------------------- |
| `index.ts`     | Public surface; route handlers import only this                 |
| `queries.ts`   | List, search, detail, filter parsing                            |
| `mutations.ts` | Create, update, archive, bulk tag — `assertContentPolicy` gate  |
| `cursor.ts`    | Keyset pagination — **no OFFSET anywhere** (F1.1 requirement 1) |
| `errors.ts`    | Typed catalog errors incl. `ContentPolicyError`                 |

### `server/services/ingest/` — 10 files

| File                    | Purpose                                                          |
| ----------------------- | ---------------------------------------------------------------- |
| `index.ts`              | F1.2 public surface: `startImport`, `previewImport`              |
| `csv.ts`                | Parsing and per-row validation; four typed failure classes       |
| `import.ts`             | Validated rows → catalog problems and links                      |
| `export.ts`             | The user's tracked list as a re-importable file                  |
| `normalise-url.ts`      | The URL normaliser — **the whole basis of dedup**                |
| `spreadsheet-safety.ts` | CSV injection, handled on the **export** side                    |
| `jobs.ts`               | The job seam — in-process, permanently (D17); `sweepStalledJobs` |
| `job-rows.ts`           | Reconstructs a job's validated rows from what the database holds |
| `library.ts`            | Curated starter library loader and validator                     |
| `limits.ts`             | Import caps in one place — `IMPORT_LIMITS`, `IMPORT_COLUMNS`     |

### `server/services/profile/` — 5 files

| File          | Purpose                                                           |
| ------------- | ----------------------------------------------------------------- |
| `index.ts`    | Public surface of the profile service                             |
| `service.ts`  | Profile reads and writes, completion checks                       |
| `avatar.ts`   | Lifecycle: presign → direct browser PUT → confirm; orphan cleanup |
| `image.ts`    | Image type validation by **magic number**, not extension          |
| `initials.ts` | Deterministic fallback avatar — initials on a generated colour    |

### `server/services/storage/` — 4 files

| File          | Purpose                                              |
| ------------- | ---------------------------------------------------- |
| `provider.ts` | Object storage behind an interface                   |
| `s3.ts`       | S3-compatible provider — Cloudflare R2 in production |
| `memory.ts`   | In-memory provider for tests                         |
| `index.ts`    | Provider selection                                   |

### `server/services/otp/` — 4 files

| File          | Purpose                                                              |
| ------------- | -------------------------------------------------------------------- |
| `provider.ts` | Delivery behind an interface so business rules never know the vendor |
| `msg91.ts`    | MSG91 provider                                                       |
| `console.ts`  | Local-dev provider — prints the code to the server console           |
| `index.ts`    | Provider selection                                                   |

### `server/services/streak/` — 8 files (F1.3)

| File                 | Purpose                                                           |
| -------------------- | ----------------------------------------------------------------- |
| `index.ts` **M**     | F1.3 public surface                                               |
| `day.ts`             | The day boundary — **the only place a timezone is resolved**      |
| `rules.ts`           | Day completion, behind one function                               |
| `freezes.ts`         | Allowance, eligibility, and what a late backfill does to coverage |
| `recompute.ts` **M** | Rebuilds a user's streak from their days                          |
| `heatmap.ts` **M**   | The 365-day contribution heatmap                                  |
| `goals.ts` **NEW**   | Which daily goal applied on a given day                           |
| `summary.ts` **NEW** | The numbers the shell shows: streak badge and goal ring           |

### `worker/` · `jobs/`

| File              | Purpose                                                                                       |
| ----------------- | --------------------------------------------------------------------------------------------- |
| `worker/index.ts` | Standalone worker entrypoint; runs as plain `tsx`, **never** with `--conditions=react-server` |
| `jobs/README.md`  | Empty and staying that way — F2.3 is cut                                                      |

---

## `tests/` (36 files)

| File                                     | Purpose                                                           |
| ---------------------------------------- | ----------------------------------------------------------------- |
| `smoke.test.ts`                          | F0.1 smoke test — makes the CI `test` step real                   |
| `helpers/db.ts`                          | Integration-test database harness                                 |
| `fixtures/perf-dataset.ts`               | Synthetic 20k-row perf fixture — **test-only, not seed data**     |
| `boundary/server-boundary.test.ts`       | The client/server boundary as a regression test                   |
| `boundary/env-example.test.ts`           | F0.1 — every env var in `.env.example` has a comment              |
| `design/tokens.test.ts`                  | F0.4 criteria that can be checked mechanically                    |
| `schema/constraints.test.ts`             | F0.2 constraints against real Postgres                            |
| `schema/indexes.test.ts`                 | F0.2 seed correctness and index usage                             |
| `schema/migrations.test.ts`              | F0.2 — migrations run up **and down** cleanly                     |
| `auth/adapter.test.ts`                   | F0.3 Auth.js adapter                                              |
| `auth/onboarding.test.ts`                | F0.3 onboarding completion and magic-link state                   |
| `auth/otp.test.ts`                       | F0.3 phone OTP against real Postgres                              |
| `auth/ratelimit.test.ts`                 | F0.3 rate limiting                                                |
| `auth/rbac.test.ts`                      | F0.3 RBAC and verification tiers                                  |
| `auth/return-to.test.ts`                 | F0.3 `returnTo` validation                                        |
| `problems/pagination.test.ts`            | F1.1 cursor pagination and filtering                              |
| `problems/search.test.ts`                | F1.1 full-text title search                                       |
| `problems/policy.test.ts`                | F1.1 content-policy gate (C1)                                     |
| `problems/plans.test.ts`                 | F1.1 — the list must use an index, not a sequential scan          |
| `profile/profile.test.ts`                | F0.5 profile writes and the initials fallback                     |
| `profile/avatar.test.ts`                 | F0.5 avatar upload security                                       |
| `profile/storage-contract.test.ts`       | Does the **real** provider hold the contract the fake implements? |
| `ingest/csv.test.ts`                     | F1.2 parsing, the caps, spreadsheet safety                        |
| `ingest/normalise-url.test.ts`           | F1.2 normaliser — 47-case table test                              |
| `ingest/import.test.ts`                  | F1.2 import against a real database                               |
| `ingest/export.test.ts`                  | F1.2 export and the **two-lap** round trip                        |
| `ingest/jobs.test.ts`                    | F1.2 the job seam, incl. polling for live progress                |
| `ingest/dedup-constraint.test.ts`        | F1.2 dedup as a **database** guarantee                            |
| `ingest/library.test.ts`                 | F1.2 the curated library, such as it is                           |
| `streak/day.test.ts`                     | F1.3 the day boundary (20 cases)                                  |
| `streak/rules.test.ts`                   | F1.3 completion and freeze arithmetic, both pure (18)             |
| `streak/recompute.test.ts`               | F1.3 the recompute (24)                                           |
| `streak/heatmap.test.ts`                 | F1.3 the heatmap (8)                                              |
| `streak/goals.test.ts` **NEW**           | F1.3 which goal applied on a day                                  |
| `streak/summary.test.ts` **NEW**         | F1.3 what the application shell shows                             |
| `streak/timezone-change.test.ts` **NEW** | F1.3 a user changing timezone mid-streak                          |

## `e2e/` (10 files)

| File                      | Purpose                                                         |
| ------------------------- | --------------------------------------------------------------- |
| `auth-flow.spec.ts`       | The sign-in journey, end to end in a browser                    |
| `goals.spec.ts` **NEW**   | F1.3 — the timezone copy appears on change, before saving (D18) |
| `onboarding.spec.ts`      | F0.3 onboarding gate, tested by **direct navigation**           |
| `profile.spec.ts`         | F0.5 — the two criteria that need a browser                     |
| `theme.spec.ts`           | F0.4 — `data-theme` switch with no flash of the wrong theme     |
| `viewports.spec.ts`       | F0.4 — layout intact at 375 / 768 / 1440px                      |
| `keyboard.spec.ts`        | F0.4 keyboard traversal (**Chromium only**)                     |
| `payload-capture.spec.ts` | Proves the capture helper works — was for F2.2, now **cut**     |
| `helpers/auth.ts`         | Auth helpers for browser tests                                  |
| `helpers/payload.ts`      | Client-payload capture                                          |

---

## `scripts/` (10 files)

| File                          | Purpose                                                            |
| ----------------------------- | ------------------------------------------------------------------ |
| `test-db.ts`                  | Local test-database control (embedded Postgres on :55432)          |
| `seed.ts`                     | Idempotent seed runner                                             |
| `seed-problems.ts`            | F0.2 seed catalog — 30 external-link problems                      |
| `contrast.ts`                 | Prints every token pair's ratio; exits non-zero on failure         |
| `explain-catalog.ts`          | Appends the F1.1 catalog plans to `docs/performance.md`            |
| `explain-report.ts`           | Regenerates `docs/performance.md` from a live database             |
| `backfill-normalised-urls.ts` | Idempotent backfill of `external_url_normalised`                   |
| `cleanup-avatars.ts`          | Orphaned-avatar cleanup, **on demand only** — nothing schedules it |
| `verify-admin-403.ts`         | Asserts the F0.3 403 criterion over real HTTP                      |
| `verify-library-urls.ts`      | Checks curated library URLs; LeetCode 403s all of them             |

## `docs/` · `data/` · `styles/`

| File                        | Purpose                                                                 |
| --------------------------- | ----------------------------------------------------------------------- |
| `docs/status.md`            | One-page DONE / DEFERRED / BLOCKED summary                              |
| `docs/acceptance-status.md` | Every acceptance criterion with evidence — **no F1.3 section yet**      |
| `docs/decisions.md` **M**   | Decisions that cost something, with rejected alternatives (through D17) |
| `docs/performance.md`       | Pasted EXPLAIN plans                                                    |
| `docs/file-map.md`          | This file                                                               |
| `data/library.json`         | Curated starter library — 34 rows; its `$comment` states why not 100    |
| `styles/tokens.css`         | Design tokens as CSS custom properties                                  |

---

## Present but gitignored

Not in the tree above; listed so the surface is complete.

| Path                                | Purpose                              |
| ----------------------------------- | ------------------------------------ |
| `CLAUDE.md`                         | Master context, read every session   |
| `docs/prompt-pack.md`               | All 29 ticket specs (93 KB)          |
| `.env`                              | Real local secrets                   |
| `.next/` · `.playwright/` · `.tmp/` | Build output, browser cache, scratch |
