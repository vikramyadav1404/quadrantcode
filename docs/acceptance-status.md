# Acceptance criteria status — Phase 0

Every criterion from the ticket pack, with how it was verified. Statuses are
deliberately not rounded up.

| Status       | Meaning                                                                                                                           |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| **DONE**     | Verified by something that runs again — a test, a CI step, or a recorded command with its output                                  |
| **DEFERRED** | Cannot be meaningfully checked yet. States the ticket that makes it checkable. A vacuous pass is recorded as DEFERRED, never DONE |
| **BLOCKED**  | Needs a credential or environment not available                                                                                   |

---

## F0.1 · `scaffold-ci`

| Criterion                                                            | Status   | Evidence                                                                          |
| -------------------------------------------------------------------- | -------- | --------------------------------------------------------------------------------- |
| typecheck && lint && test pass clean                                 | **DONE** | CI job `typecheck · lint · test · build`, all steps green                         |
| CI green on GitHub for a pushed branch                               | **DONE** | Run `31668483268` on `feat/F0.1-scaffold-ci`. Went red first — see the note below |
| Importing a `server/` module from a client component fails the build | **DONE** | `tests/boundary/server-boundary.test.ts` (17 tests) + the CI `Build` step         |
| Deleting a required env var causes a readable startup error          | **DONE** | `tests/smoke.test.ts`; reproduced by running the worker with no `DATABASE_URL`    |
| `npm run worker` starts independently of `npm run dev`               | **DONE** | Runs as plain `tsx worker/index.ts`; no `--conditions` flag (asserted by a test)  |
| Every env var in `.env.example` has a comment                        | **DONE** | `tests/boundary/env-example.test.ts` — 36 vars, 0 uncommented                     |

> **The CI criterion failed first, twice-over.** There was no git remote at all
> until this point, so the workflow had never run. The first run then failed on
> the secret-scan step: `gitleaks-action@v2` computes a `<before>^..<after>`
> range, and on a first push `<before>` is the root commit, whose `^` is an
> unknown revision. It aborted having scanned **0 bytes** while logging _"no
> leaks found in partial scan"_. See `docs/decisions.md` D4.

---

## F0.2 · `core-schema`

| Criterion                                                       | Status   | Evidence                                                                                           |
| --------------------------------------------------------------- | -------- | -------------------------------------------------------------------------------------------------- |
| Migration runs up and down cleanly                              | **DONE** | `tests/schema/migrations.test.ts` — up → down → up leaves no orphaned table, enum or function      |
| External-link problem with a statement is REJECTED by the CHECK | **DONE** | `tests/schema/constraints.test.ts`, 6 cases, asserting SQLSTATE `23514` and the constraint by name |
| Duplicate `(user_id, problem_id)` rejected                      | **DONE** | Same suite, asserts `23505`                                                                        |
| Two users may have NULL phone; two may not share a real one     | **DONE** | Same suite (partial unique index)                                                                  |
| Seed inserts 30 problems with tags                              | **DONE** | `tests/schema/indexes.test.ts`                                                                     |
| EXPLAIN shows an index scan for each of the four queries        | **DONE** | Same suite + pasted plans in `docs/performance.md`                                                 |

> The EXPLAIN criterion is only meaningful on production-shaped data: at 30 rows
> Postgres correctly prefers a sequential scan. The synthetic fixture is
> `tests/fixtures/perf-dataset.ts` — **fabricated, test-only**, using the RFC 2606
> `.invalid` TLD so no row can pose as a real platform link, and refusing to run
> without `TEST_DATABASE_URL`. Two tests assert the application seed contains
> zero synthetic rows.

---

## F0.3 · `auth-verification`

| Criterion                                                     | Status      | Evidence                                                                                                                                                                                              |
| ------------------------------------------------------------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Email magic-link login works end to end against a real inbox  | **BLOCKED** | Needs `RESEND_API_KEY`. Everything after the click **is** covered by `e2e/auth-flow.spec.ts`, which mints a token the same way Auth.js does and drives the real callback. Only delivery is unverified |
| The 4th OTP request within an hour is blocked                 | **DONE**    | `tests/auth/otp.test.ts`                                                                                                                                                                              |
| The 6th wrong verify attempt is rejected and the code burned  | **DONE**    | Same suite — also asserts the correct code fails afterwards                                                                                                                                           |
| An expired code fails even with correct digits                | **DONE**    | Same suite, injected clock                                                                                                                                                                            |
| Attaching a phone bound to another active account is rejected | **DONE**    | Same suite — also asserts no SMS was sent                                                                                                                                                             |
| A non-admin hitting `/admin` gets 403, not a redirect loop    | **DONE**    | `e2e/auth-flow.spec.ts` asserts HTTP 403; `scripts/verify-admin-403.ts` records anonymous 307 / non-admin 403 / admin 200 / stale cookie 401                                                          |
| `verification_level` recompute matches the cached column      | **DONE**    | `tests/auth/rbac.test.ts` — drift repaired in both directions, idempotent                                                                                                                             |

---

## F0.4 · `design-system`

| Criterion                                                      | Status              | Evidence                                                                                                                                                                                                                                                  |
| -------------------------------------------------------------- | ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Every nav item reachable by keyboard with a visible focus ring | **PARTIAL**         | Focus ring is a global `:focus-visible` rule; skip link, `aria-current` and landmarks asserted in `e2e/viewports.spec.ts`. **Full keyboard traversal is not yet asserted** — no spec tabs through every control                                           |
| Measured contrast documented in code, ≥4.5:1 body text         | **DONE**            | `npm run contrast` (CI step) + `tests/design/tokens.test.ts`; numbers pasted into `styles/tokens.css`. `border` failed at 2.46/2.52 and was changed, not waived                                                                                           |
| Layout intact at 375px, 768px, 1440px                          | **DONE**            | `e2e/viewports.spec.ts` — no horizontal overflow, exactly one nav visible and the correct one per width, nothing past the right edge                                                                                                                      |
| **Every list route has a skeleton state**                      | **DEFERRED → F1.1** | **There are no list routes yet.** Only `/dashboard` has a `loading.tsx`. The primitives exist (`Skeleton`, `CardSkeleton`, `StatGridSkeleton`, `TableSkeleton`) but the criterion is currently **vacuous** and is recorded as deferred rather than passed |
| Theme switches via `data-theme` with no flash of wrong theme   | **DONE**            | `e2e/theme.spec.ts` asserts the _mechanism_: the bootstrap script is inline, in `<head>`, neither `async` nor `defer`, and the attribute is applied by document commit. A final-state assertion cannot detect a flash                                     |
| `grep` for hex colours in `components/` returns nothing        | **DONE**            | `tests/design/tokens.test.ts` walks `components/` and `app/`, rejecting hex, `rgb()` and `hsl()`                                                                                                                                                          |

---

## Open, carried forward

1. **Keyboard traversal** (F0.4) is partial. A spec that tabs through the shell
   and asserts focus order belongs with F1.1, when there is a list route with
   real interactive rows to traverse.
2. **Magic-link delivery** (F0.3) stays BLOCKED until a Resend key exists.
3. **Skeleton coverage** (F0.4) is re-checked when F1.1 adds `/problems`.
