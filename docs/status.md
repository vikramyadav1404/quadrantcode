# Quadrantcode status

_Updated 13 September 2026 on `main`, after the first real deployment: Neon
migrated and seeded, GitHub sign-in working, and a `/problems` diagnosis that
found the filter bug recorded below. Previous revisions: 11 September
(F3.1b · durable execution queue), 1 September (native-platform pass)._

## Current outcome

The existing Next.js application has been retained and hardened; it was not
rebuilt. The product UI, database schema, migrations, authentication flows,
session tracking, analytics, revision, timeline, mistake memory, import/export,
admin controls, and Monaco execution pipeline remain in place.

The repository is now **code-ready for a managed production deployment**, but
it is not honestly “live” yet. A live URL requires external accounts,
credentials, a production database, and a domain. Those values must be entered
directly in provider/Vercel dashboards and must never be pasted into chat or
committed.

## Native-platform completion

The repository now also contains the complete native Quadrantcode practice
workflow described in `docs/native-platform.md`:

1. Exactly 100 independently authored DSA problem records, with the required
   35 easy / 45 medium / 20 hard and topic distribution.
2. C11, C++17, Java, Python 3 and JavaScript templates, wrappers and trusted
   references for every problem. Local compiler validation executed 3,000
   reference/test pairs successfully.
3. Native Run and Submit, hidden-test redaction, persisted attempts and
   server-verified learning effects.
4. Company preparation pages, honest evidence labels, moderated candidate
   reports and the frequent-report threshold of three independent reports.
5. Exactly 20 original pattern-based mock papers, two for each target company,
   plus timed attempts and per-question scoring.
6. Admin review, preview, content editing, provider validation, publish gates,
   audit history and guarded import/export.

Generated content intentionally imports as `needs_review`. Local compiler
validation is strong reproducible evidence, but it is not a live production
provider run. Publishing therefore still requires an administrator to validate
every language/test combination through the explicitly configured provider.

## Completed in this pass

1. Added cross-field environment validation and a Vercel deployment gate.
2. Added provider-neutral direct database URL support for migrations.
3. Removed silent production fallbacks: no fake execution verdict, empty
   Resend provider, console OTP, in-memory storage, or per-instance limiter can
   masquerade as production behavior.
4. Made unavailable email, phone, storage, and execution features explicit and
   controlled.
5. Added Sentry SDK wiring for browser, Node, Edge, nested server errors, and
   React error boundaries. Source-map upload remains blocked on Sentry account
   values.
6. Added CSP, HSTS, clickjacking, MIME-sniffing, referrer, permissions, and
   opener-policy headers.
7. Added liveness (`/api/health/live`) and readiness
   (`/api/health/ready`) endpoints while preserving `/api/health`.
8. Added metadata, canonical URLs, robots, sitemap, favicon, Open Graph image,
   404, root error, privacy, terms, security, and contact surfaces.
9. Added a manual, protected production migration workflow and documented the
   Vercel Git deployment path.
10. Updated vulnerable runtime dependencies/overrides identified by `npm audit`.
11. Added Vercel Queue durable execution dispatch, Neon leases/fencing/recovery,
    an optional explicit Judge0 fallback, and a deny-all Vercel Sandbox provider.
12. Added the custom five-language image/supervisor contract. Its lock remains
    unverified until the image is built, scanned and proven in preview.

## Local release-gate evidence

Run on 11 September 2026 on `feat/F3.1b-execution-queue`, against a real local
PostgreSQL test database:

| Gate                         | Result                                                               |
| ---------------------------- | -------------------------------------------------------------------- |
| TypeScript, ESLint, Prettier | pass                                                                 |
| Production build             | pass; 44 page bundles and 22 route handlers                          |
| Vitest                       | 1,250 pass, 0 fail, 5 skipped (86 files)                             |
| Playwright                   | 128/128 pass against `next start` and a local Judge0 contract server |
| Native content               | 100/100 problems and 20/20 papers pass structural validation         |
| WCAG token contrast          | all pairs pass                                                       |
| Production dependency audit  | 0 vulnerabilities                                                    |
| **Execution image lock**     | **expected FAIL — see below**                                        |

`npm run execution:image:verify` reports four issues and is expected to until
the image is built:

```
execution image: toolchain lock is not marked verified
execution image: built VCR image digest is missing or mutable
execution image: base image digest is missing or mutable
execution image: Node image digest is missing or mutable
```

The five skips are the `STORAGE_INTEGRATION=1` live-bucket suite
(`tests/profile/storage-contract.test.ts`), unchanged; no execution test skips.

Two figures in the previous table were **not** carried forward, because they are
not comparable to this branch and reprinting them would have been a false
baseline:

- _53 application pages_ counted the build's printed route table. The figures
  above are counted from `.next/server/app` instead, and are not the same
  measurement.
- _Playwright 118/118_ predates `auth-providers.spec.ts` and
  `native-platform.spec.ts`, which landed after 1 September. Against the real
  baseline — `main` at this branch point, 113 — the suite is **113 → 128**:
  `execution-queue.spec.ts` (5) and `machine-routes.spec.ts` (10).

Reference execution (3,000 local compiler runs) was not re-run this pass and its
1 September result stands.

This evidence makes the repository code-ready. It does not replace a preview
deployment, real provider tests, backup/restore drill, or post-deploy smoke
test.

## External launch blockers

| Blocker                                           | Needed for                                            |
| ------------------------------------------------- | ----------------------------------------------------- |
| Managed PostgreSQL pooled URL + direct URL        | durable production data and migrations                |
| Final HTTPS domain                                | canonical URLs, cookies, email links, OAuth callbacks |
| 32+ character `AUTH_SECRET`                       | Auth.js and OTP HMAC security                         |
| GitHub OAuth app ID/secret                        | GitHub sign-in                                        |
| Resend key, verified sending domain, from address | email magic links                                     |
| Upstash REST URL/token                            | distributed serverless rate limits                    |
| Sentry DSNs/org/project/build token               | monitoring and readable production stack traces       |
| Public support mailbox                            | legal/contact pages                                   |
| MSG91 key/template                                | phone OTP, only when that feature is enabled          |
| Judge0 URL/key                                    | real execution, only when execution is enabled        |
| S3-compatible avatar bucket credentials/domain    | avatar uploads                                        |

## Standing risks

### The execution consumer's access control is a beta platform feature

`/api/queues/executions` is **not authenticated by a signature**. Neither
`validExecutionDelivery` nor the `@vercel/queue` SDK performs any cryptographic
check: the SDK's only rejections are CloudEvent parse errors, and a search of
its distributed source for `signature`, `verify` or `hmac` returns nothing.

What keeps the route private is the `queue/v2beta` trigger declared in
`vercel.json`. Per Vercel's public-beta changelog: _"Adding a trigger makes the
route private: it has no public URL and only Vercel's queue infrastructure can
invoke it."_

Three consequences worth holding:

1. **It is `v2beta`.** The trigger is an experimental, pre-GA API. A breaking
   change, a rename, or a change in privacy semantics between beta and GA
   directly changes whether this endpoint is reachable from the internet.
   Re-read the changelog before upgrading `@vercel/queue` (pinned at `0.5.0`).
2. **Deleting the trigger is a silent privilege escalation.** It breaks no
   build, fails no typecheck, and changes no application code — it just turns a
   private handler public. `tests/security/machine-routes.test.ts` asserts the
   trigger and its topic so that removal fails CI instead of shipping.
3. **The blast radius is deliberately small**, which is why this is an accepted
   risk rather than a blocker. The queue payload is `{ version: 1, jobId }` and
   nothing else — no code, no language, no test data ever leaves the database
   (`dispatchExecutionJob`). A forged delivery can therefore only name a job
   UUID; it cannot inject code or select another user's data, because the row
   decides both, not the message.

   The defences are listed in the order they should be relied on:

   1. **Idempotency, which holds even against a correctly guessed id.** An
      unknown id is a no-op, a terminal id is a no-op, and a mismatched
      `queueMessageId` is refused. Past that, the atomic claim, the 75-second
      lease and the unique `run_attempts.job_id` mean a replayed or duplicated
      delivery cannot produce a second effect. This is structural: it does not
      depend on the attacker failing to know something.
   2. **Unguessability, as a second line only.** Ids are
      `uuid … DEFAULT gen_random_uuid()` (`0014_execution_pipeline.sql`), i.e.
      **UUIDv4** — 122 random bits, not the time-ordered UUIDv7 whose leading
      timestamp would narrow the search space. Worth having, but it is entropy,
      not a control, and it is deliberately not the argument this rests on.

`permitsQueueConsumer` (VERCEL=1 **and** `FEATURE_EXECUTION`) is the second
control, and is the reason the route answers 404 everywhere but production.

**Revisit the moment the queue payload carries anything beyond a job id.** At
that point the argument above stops holding and the payload needs its own HMAC,
because the platform boundary would no longer be the only thing between an
attacker and the contents of a job.

### Concurrent test runs share one database

`tests/helpers/db.ts` rebuilds the fixed `public` schema in `beforeAll`.
`vitest.config.ts` sets `fileParallelism: false` so files within a run cannot
collide, but **two runs against the same database will**, with failures like
`relation "users" does not exist` that look like code faults and are not. Run
one suite at a time against `:55432`.

### `e2e/session.spec.ts` is flaky on a cold server, and it is the spec's fault

Every test in that file does `page.goto('/problems/timer-alpha')` and then
immediately clicks `Start solving`, with **nothing waiting for hydration**. On a
cold `next start` the click can land before React has attached the handler, and
nothing happens at all: the failure surfaces as a 10s or 30s timeout waiting for
the timer bar, on whichever tests happened to be unlucky. The captured snapshot
for one of them shows the tell — `Start solving` still on screen, no timer bar,
and an **empty `status` region**, meaning the server action never fired rather
than failing.

Measured 2026-09-15, running `npm run build` and then the spec immediately, so
the server is cold each time:

| Working tree                                      | run 1    | run 2    | run 3    |
| ------------------------------------------------- | -------- | -------- | -------- |
| `main`, changes stashed                           | 1 failed | 0 failed | —        |
| + a second `getActiveSession` on the problem page | 4 failed | 2 failed | 3 failed |
| + that read replaced by shell context (shipped)   | 1 failed | —        | —        |

Two things this establishes. **The flake is pre-existing** — the baseline row is
`main` with the working tree stashed, and it reproduces. And **page render cost
feeds it directly**: adding one DB round-trip to the problem page moved the
failure count up consistently, and removing it put the count back on baseline.
That is why the shipped fix reads the live session from a shell context instead
of re-querying it (`components/session/ActiveSessionContext.tsx`).

A different failing subset each run is the signature; the same run warm is
green, in 16s with every test under 1s. **Do not read a red cold run here as a
regression without stashing and reproducing first.**

Not fixed because it is a change to eight existing tests and belongs in its own
ticket. The fix is to wait for the button to be interactive rather than present
— the same reason the suite already waits on regions elsewhere.

### Two feature flags are deliberately unwired

`FEATURE_TIMELINE` (F3.2) and `FEATURE_ORIGINAL_PROBLEMS` (F4.1) are declared in
`lib/flags.ts` and read by nothing. **Setting either to `true` or `false`
changes no behaviour.** Timeline capture runs regardless; native problem content
is reachable regardless.

They survived the 2026-09-16 cull that deleted ten flags for exactly this fault,
because unlike those ten they guard features that exist and would benefit from a
switch — a kill switch for snapshot capture has real value given the ninety-day
retention promise, and native content is the premium tier. They are kept as
_intent_, not as a control, and are labelled that way in `.env.example` so
nobody reads `FEATURE_TIMELINE=false` and concludes capture is off.

**Anyone wiring these owes the same two-layer treatment `FEATURE_MOCKS` got:**
`isFeatureEnabled` at the page to avoid offering a control that throws, and
`assertFeatureEnabled` at the action or service, which is the actual gate. Hiding
a button is not a gate.

### A forgotten session keeps writing

`components/session/TimerBar.tsx:81` posts to `/api/session/heartbeat` every 30
seconds while a session is `active`. There is **no `visibilitychange` handler** —
grepped, zero. A backgrounded tab, a minimised window or a session the user
simply forgot keeps posting.

Each tick is one single-row `UPDATE solve_sessions SET last_heartbeat_at, …`, so
it costs nothing in lock terms — Postgres readers and writers do not block each
other. What it does cost is a connection out of a pool of three, and a Neon
compute that never gets to suspend, which burns free-tier CU-hours for as long
as the tab is open.

It is also why cold-start latency cannot be measured while any session is open:
the heartbeat keeps the function warm.

## Known UI limitations — read before retrying either

Two pieces of catalog polish were attempted, understood, and deliberately left
out during the solve-screen polish pass. Both look like oversights. Neither is.

### The catalog header cannot be sticky without changing the scroll model

`app/(app)/problems/page.tsx` wraps the table in `overflow-x-auto` so it scrolls
sideways at 375px instead of reflowing, which `e2e/viewports.spec.ts` holds.

Per CSS spec, setting `overflow-x` to anything other than `visible` computes
`overflow-y` to `auto` as well. That wrapper is therefore a scroll container on
**both** axes, and a `position: sticky` header inside it anchors to the wrapper
— which has no bounded height and so never scrolls vertically. The header would
never stick, in any theme, at any width.

Making it work means giving the wrapper a fixed height and moving vertical
scrolling inside it. That is a layout restructure, which the pass that raised
this explicitly forbade. Revisit only together with a decision to change the
catalog's scroll model, not as a CSS tweak.

### Zebra banding makes hover invisible in the light theme

`--surface-raised` and `--background` are both `#ffffff` in light
(`lib/design-tokens.ts`). Banding odd rows with `--surface` and hovering with
`--surface-raised` makes the hover state invisible on every even row; swapping
them moves the problem to the odd rows. There is no third neutral surface token
to reach for.

The single hover band on `--surface` is kept instead.

A future attempt needs a **new token with a declared contrast pair**, not a
Tailwind opacity modifier. `npm run contrast` measures the pairs listed in
`TEXT_PAIRS` / `NON_TEXT_PAIRS` and never touches the DOM, so an alpha tint is
invisible to the gate — it would pass by not being looked at, which is the same
vacuous-pass failure the verification standard in CLAUDE.md exists to stop.

### The contrast gate only measures pairs that are declared

`npm run contrast` and `tests/design/contrast.test.ts` read the `TEXT_PAIRS`
and `NON_TEXT_PAIRS` tables in `lib/design-tokens.ts`. **They never touch the
DOM.** A foreground/background combination that no one has added to those
tables is not measured, not reported, and not failed — it passes by not being
looked at.

That is not hypothetical. Declaring `border on surface-raised` during the
solve-screen redesign measured it for the first time at **2.78:1 against a 3:1
non-text minimum** — a failure that had been shipping **since F0.4**, in
`TopicChips`, `ConfirmDialog` and the stuck dialog, all of which draw
`--border` on `--surface-raised`. Nothing regressed; the pairing had simply
never been declared.

Fixed the way this project requires — the token changed rather than the
threshold being waived. Dark `--border` went `#5f656f` → `#6a707b`. `#646a75`
would have cleared it at exactly 3.00; the value with real margin (3.28) was
taken instead, because a hairline pass is one rounding change from a fail.

**The rule that follows:** when a component introduces a colour combination the
tables do not already list, add it to `lib/design-tokens.ts` in the same change.
`lib/design-tokens.ts:58` says so, and this is what it costs when it is missed.
The tables went from 19 pairs to 27 in that one pass, which is a measure of how
much of the app had never been checked rather than of how much was added.

## Proposed optimisations, not implemented

Written down from a diagnosis session. **None of these are applied.** The
numbers they trade against are not measured yet — `problems.page`,
`problems.list` and `shell.summary` spans exist in the code for exactly that,
and the decision waits on them.

### Skip `recomputeStreak` when the streak cannot have broken

`summariseForShell` calls `recomputeStreak` on **every signed-in page render**.
That is four queries: a 400-day window of `daily_sessions`, `daily_goals`,
`streak_freezes`, plus the stored `user_streaks` row.

The proposal: `user_streaks.lastCompletedLocalDate` is already read in that
`Promise.all`. If it is **today or yesterday** in the user's zone, the streak
cannot have broken, so skip the other three queries and serve the stored row.

**It holds against the streak rules.** Checked, rather than assumed:

- **Freezes are not a hole.** `streak_freezes` is written _only by
  `recomputeStreak` itself_ (`recompute.ts:237`, `:248`) — it is a derived
  projection, never granted by a user action. And `lastCompletedLocalDate`
  already means "the last day that counted, **whether completed or frozen**",
  so a freeze-covered day is inside the gate by construction.
- **Goal changes recompute.** `settings/goals/actions.ts:79`.
- **Timezone changes recompute, in the right order.** The same action updates
  the zone first, derives `today` in the _new_ zone, then recomputes.
- **Both `daily_sessions` writers recompute after writing** —
  `submission-effects.ts` via `pipeline.ts:392`, and `lifecycle.ts:578/607` via
  `lifecycle.ts:358`.

So every input has a writer that recomputes behind it. Between writes, only the
passage of time can change the answer — which is exactly what the gate detects.

**Two things to get right if it is implemented:**

1. The comparison must be `=== today || === yesterday`, **not `>= yesterday`**.
   A backward timezone change can move `today` earlier than
   `lastCompletedLocalDate`; a future-dated value must fall through to a
   recompute, not be skipped.
2. **It trades a self-healing read for an unenforced invariant.** Today, a row
   written straight into `daily_sessions` by anything is repaired on the next
   page load. With the gate it is not, until the date moves. Such a writer
   already exists: **`scripts/demo-seed.ts:212`** inserts into `daily_sessions`
   directly without recomputing. It is a dev script, but nothing stops the next
   one being a backfill or an admin tool.

**The win is smaller than it looks.** The four queries already run in
`Promise.all`, so the saving is roughly **one round trip, not four** — plus
three fewer connections, which matters more than it sounds given `max: 3`
below. The cold path gets one round trip _worse_: read the stored row, decide,
then run the rest.

### The connection pool is sized for a database this project no longer uses

`server/db/client.ts` sets `max: isWorker ? 10 : 3`, and its comment explains
the three as keeping "a small pool per instance" while relying on "the
**Supabase** pooled URL". The stack is Neon now; the premise is stale. Git
history puts the number in `6e3fd68`, arriving with the client/index split
rather than as a separately reasoned choice.

The pool is a module-level singleton, so it is **per lambda instance**, not per
request. Meanwhile the layout's `Promise.all` groups ask for four to five
concurrent queries — at `max: 3` they queue.

Neon is nowhere near binding. Measured on the live compute:

```
max_connections     901        in use at the time    16
pooled endpoint     max_client_conn = 10000   (Neon docs)
```

Raising the non-worker pool to 8–10 would let the existing parallelism actually
run. **Estimate, not measurement:** the saving is one round trip per affected
group, so its value scales with the per-round-trip Neon latency that has not
been measured yet.

## Deliberately not claimed

- No production or preview deployment has been created from this workspace.
- No destructive production migration, DNS change, OAuth app creation, paid
  resource, or provider test has been performed.
- Queue-backed retries and scheduled background work are not part of the
  trimmed architecture. In-process jobs persist their state in Postgres, but a
  dead process requires the documented sweep/retry operations.
- Billing, notifications, contests, tracks, coins, and AI remain cut or
  disabled features. Their placeholder credentials do not make them built.

See `docs/deployment.md` for the exact launch sequence and
`docs/launch-checklist.md` for the final go/no-go checklist.
