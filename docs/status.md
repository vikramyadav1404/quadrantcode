# Where the project stands — Phase 0 + F1.1

_Last updated: 2026-08-15, after the F0.3 auth-UI amendment._

One place to look. Per-criterion detail lives in `docs/acceptance-status.md`;
this is the summary and, more usefully, the list of things only you can unblock.

**Tests:** 336 passing, 5 skipped (341 total, 20 files) + 42 Playwright.
The 5 skips are all the live-bucket suite below — nothing else is silently
skipping.

**CI:** run [`31829583656`](https://github.com/vikramyadav1404/traceloop/actions/runs/31829583656)
on `feat/F0.3-auth-ui` — `typecheck · lint · test · build` **success**,
`browser (playwright)` **success**.

---

## Shippable today

Six tickets are complete and openable in a browser: a signed-out flow
(`/login` → `/login/verify` → `/onboarding`), an authenticated shell with
working theme and navigation, a problem catalog with search, filtering and
keyset pagination, admin CRUD behind a role gate, and a profile page with
avatar upload.

| Ticket | Feature                              | State                          |
| ------ | ------------------------------------ | ------------------------------ |
| F0.1   | Repository Scaffold & CI             | **DONE**                       |
| F0.2   | Identity & Problem Catalog Schema    | **DONE**                       |
| F0.3   | Auth, Phone OTP & Verification Tiers | **DONE** — delivery BLOCKED    |
| F0.3+  | Auth UI amendment                    | **DONE**                       |
| F0.4   | Design System & Application Shell    | **DONE**                       |
| F0.5   | User Profile & Avatar Upload         | **DONE** — live bucket BLOCKED |
| F1.1   | Problem Catalog, Search & Admin CRUD | **DONE**                       |

Every `FEATURE_*` flag is still `false`, as intended.

---

## BLOCKED ON YOU

Nothing here can be resolved from inside this environment. Ordered by how much
it currently costs.

| #   | Need                                                        | Unblocks                                   | Cost of staying blocked                                                                                                                                                                                        |
| --- | ----------------------------------------------------------- | ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **`RESEND_API_KEY`**                                        | Magic-link delivery                        | **Nobody can actually sign in.** Everything after the click is tested against the real callback; only the email send is unverified. The e2e server logs a genuine Resend 401, so the call is really being made |
| 2   | **Cloudflare R2 keys** + a public `r2.dev` or custom domain | Avatar upload end to end                   | 5 written assertions are skipping. The client is proven to sign a 60s expiry; that the **bucket honours it** has never run. The public-URL half is a deployment dependency, not code (see D11)                 |
| 3   | **`MSG91_AUTH_KEY`** + template id                          | Phone OTP delivery                         | Service, rate limits and lockout are tested against a fake. Real SMS never sent. `FEATURE_PHONE_OTP=false`, so this blocks nothing shipping today                                                              |
| 4   | **Upstash Redis** URL + token                               | Production rate limiting, and F2.3's queue | The in-memory limiter is per-process and would not limit anything on serverless. Production now **refuses to start** without Redis rather than pretending — so this is required before any real deploy         |
| 5   | **Judge0** URL                                              | F3.1                                       | Not needed until Phase 3                                                                                                                                                                                       |
| 6   | **Razorpay** keys                                           | F4.4                                       | Not needed until Phase 4                                                                                                                                                                                       |

Items 1 and 2 are the ones I would get first: without them the product cannot be
demonstrated end to end by a real person, which is the only thing the current
build is missing.

---

## DEFERRED — recorded, not forgotten

| Item                                 | Closes in   | Why deferred                                                                                                                                                          |
| ------------------------------------ | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Orphaned-avatar cleanup scheduling   | **F2.3**    | `cleanupOrphanedAvatars` is written and tested; there is no queue runtime yet to attach it to                                                                         |
| Profile save under throttled slow-3G | unscheduled | Optimistic save has a 10s timeout and rolls back to the last server-confirmed state, but no Playwright throttling test exists. Recorded as **NOT VERIFIED**, not DONE |

Two criteria that were deferred are now **closed**: skeleton states (by F1.1's
`/problems`) and full keyboard traversal (by the F0.3 amendment, at the third
attempt).

---

## Known limits of what is claimed

Stated so they are not mistaken for coverage:

- The keyboard spec is **Chromium only**, and asserts a focus ring _exists_, not
  that it meets a contrast ratio. Screen-reader announcement is not asserted.
- Performance is measured on a **synthetic 20k-row fixture**
  (`tests/fixtures/perf-dataset.ts`, `.invalid` TLD, test-only), not production
  traffic.
- No load testing, no concurrent-user testing, and no deploy has happened —
  there is no hosting environment yet.
- The boundary suite failed **once** in one full run and has not reproduced in
  three subsequent runs. I could not determine the cause and did not change
  anything to "fix" it; it is not a timeout (the global limit is 30s and the
  test takes ~3s) and it writes nothing to disk. Recorded here rather than
  dismissed, because an unexplained intermittent failure is a real finding.

---

## What I would do next

F1.2 `bulk-ingest` — CSV ingestion, export and the curated library. It is the
next ticket in order, it needs no credentials, and it is what makes the catalog
useful with real volume rather than seed data.
