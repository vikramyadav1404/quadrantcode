# Where the project stands

_Last updated: 2026-08-28, after F1.5._

One place to look. Per-criterion detail lives in `docs/acceptance-status.md`;
this is the summary and, more usefully, the list of things only you can unblock.

**Tests:** 718 passing, 5 skipped (723 total, 43 files) + 55 Playwright.
The 5 skips are all the live-bucket suite below — nothing else is silently
skipping. If a run reports far fewer, they skipped silently: check the count,
not the colour.

**CI:** last green run [`31829583656`](https://github.com/vikramyadav1404/traceloop/actions/runs/31829583656)
on `feat/F0.3-auth-ui` — both jobs success. F1.2 through F1.5 are merged into
local `main` but **nothing since F1.1 has been pushed**, so none of them carries
a CI result. Both suites were run locally in full against the embedded Postgres.

---

## Target scope — 18 features, not 29

Set by Vikram on 2026-08-15. The build ships **8 done + 11 remaining**, in this
order:

> F1.3 · F1.4 · F1.5 · F1.6 · F2.1 · F3.1 · F3.2 · F3.3 · F3.5 · F4.6 · F4.8

**Cut:** F2.2, F2.3, F2.4, F2.5, F4.1, F4.2, F4.3, F4.4, F4.5, F4.7, and F1.2's
curated 100-problem library. The README carries the full built/planned/cut
table; nothing cut is described in the present tense anywhere else.

**The cut that changes engineering, not just schedule: F2.3.** There is no queue
and there will not be one, so the in-process job runner is permanent. No
automatic retry, no scheduled sweeps, no background cleanup. **D17** records
what that costs, how recovery works instead, and the decision F3.1 now needs
before it starts — it is specified as _queued_ Judge0 execution and its queue is
cut.

Phase 3 survives intact, which is the point: Solve Intelligence is the project's
identity and was never the part to trim.

---

## Shippable today

Eleven tickets are complete and openable in a browser: a signed-out flow
(`/login` → `/login/verify` → `/onboarding`), an authenticated shell with
working theme and navigation, a problem catalog with search, filtering and
keyset pagination, admin CRUD behind a role gate, a profile page with avatar
upload, a daily-goals page with a 365-day heatmap whose streak numbers appear in
the top bar on every page, and a solve timer that starts from a problem page and
follows you across the app — server-authoritative, so it survives a refresh, with
stuck markers during the solve and a reflection afterwards that feeds the attempt
history on every problem page.

| Ticket | Feature                              | State                          |
| ------ | ------------------------------------ | ------------------------------ |
| F0.1   | Repository Scaffold & CI             | **DONE**                       |
| F0.2   | Identity & Problem Catalog Schema    | **DONE**                       |
| F0.3   | Auth, Phone OTP & Verification Tiers | **DONE** — delivery BLOCKED    |
| F0.3+  | Auth UI amendment                    | **DONE**                       |
| F0.4   | Design System & Application Shell    | **DONE**                       |
| F0.5   | User Profile & Avatar Upload         | **DONE** — live bucket BLOCKED |
| F1.1   | Problem Catalog, Search & Admin CRUD | **DONE**                       |
| F1.2   | CSV Ingestion & Export               | **DONE** — library BLOCKED     |
| F1.3   | Streak & Daily Goal Engine           | **DONE**                       |
| F1.4   | Server-Authoritative Session Timer   | **DONE** — no scheduler (D20)  |
| F1.5   | Attempt History & Reflection         | **DONE** — hints DEFERRED      |

Every `FEATURE_*` flag is still `false`, as intended.

---

## BLOCKED ON YOU

Nothing here can be resolved from inside this environment. Ordered by how much
it currently costs.

| #   | Need                                                        | Unblocks                 | Cost of staying blocked                                                                                                                                                                                                                       |
| --- | ----------------------------------------------------------- | ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **`RESEND_API_KEY`**                                        | Magic-link delivery      | **Nobody can actually sign in.** Everything after the click is tested against the real callback; only the email send is unverified. The e2e server logs a genuine Resend 401, so the call is really being made                                |
| 2   | **Cloudflare R2 keys** + a public `r2.dev` or custom domain | Avatar upload end to end | 5 written assertions are skipping. The client is proven to sign a 60s expiry; that the **bucket honours it** has never run. The public-URL half is a deployment dependency, not code (see D11)                                                |
| 3   | **`MSG91_AUTH_KEY`** + template id                          | Phone OTP delivery       | Service, rate limits and lockout are tested against a fake. Real SMS never sent. `FEATURE_PHONE_OTP=false`, so this blocks nothing shipping today                                                                                             |
| 4   | **Upstash Redis** URL + token                               | Production rate limiting | The in-memory limiter is per-process and would not limit anything on serverless. Production **refuses to start** without Redis rather than pretending, so this is required before any real deploy. No longer needed for a queue — F2.3 is cut |
| 5   | **Judge0** URL                                              | F3.1                     | Not needed until Phase 3                                                                                                                                                                                                                      |
| 6   | **Razorpay** keys                                           | F4.4                     | Not needed until Phase 4                                                                                                                                                                                                                      |

Items 1 and 2 are the ones I would get first: without them the product cannot be
demonstrated end to end by a real person, which is the only thing the current
build is missing.

---

## DEFERRED — recorded, not forgotten

| Item                                 | Closes in   | Why deferred                                                                                                                                                          |
| ------------------------------------ | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Orphaned-avatar cleanup scheduling   | **never**   | F2.3 is cut, so nothing will schedule it. Run `npm run avatars:cleanup` on demand; orphans accumulate until you do (D17)                                              |
| Automatic retry of a dead import job | **never**   | No queue. Recovery is user-driven: re-uploading the same file re-enqueues it, idempotently (D17)                                                                      |
| Curated 100-problem library          | **BLOCKED** | A small verified subset ships. The full list needs real data from your solve history — I will not invent URLs (C1)                                                    |
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
  four subsequent runs. Cause unknown; nothing was changed to "fix" it. Tracked
  in **[#3](https://github.com/vikramyadav1404/traceloop/issues/3)** with the
  captured output, what was ruled out, and the reproduction harness — not left
  as a line in this document, because the risk with a flake is a team learning
  to ignore red.

---

## What I would do next

F1.6 `analytics-core` — the rollup-backed dashboard. It is the next ticket in
order, it needs no credentials, and F1.4 and F1.5 have now produced the three
things it aggregates: durations, outcomes and mistake categories.

Two of its rules are worth reading before starting. Heavy aggregates are
precomputed into a daily rollup table and the staleness is stated in the UI
("as of 03:00 today") rather than implied — and with F2.3 cut, nothing schedules
that rollup, so it runs on the request path like every other job here (D17).
The other is a naming rule: the weak-topic score is deterministic, and the
ticket forbids calling it AI or a prediction anywhere in code or UI.
