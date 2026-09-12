# Quadrantcode status

_Updated 11 September 2026 on `feat/F3.1b-execution-queue` (F3.1b · durable
execution queue). Previous revision: 1 September 2026, native-platform pass._

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
