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

---

## F1.1 · `problem-catalog`

| Criterion                                                                 | Status   | Evidence                                                                                                                                                               |
| ------------------------------------------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Filtered list at 1000 problems responds in <200ms server time             | **DONE** | `tests/problems/plans.test.ts` measures it at **20,000** rows, twenty times the required scale. Unfiltered page 0.127 ms, filtered keyset 0.041 ms                     |
| Title search returns ranked results and uses the GIN index                | **DONE** | `tests/problems/search.test.ts` — 8 tests incl. ranking, stemming, and an EXPLAIN assertion on `problems_search_vector_idx`                                            |
| Cursor pagination is stable across inserts                                | **DONE** | `tests/problems/pagination.test.ts` inserts rows BETWEEN page fetches and asserts the pages still partition the original set; a separate test covers `created_at` ties |
| Saving a statement onto an external-link problem returns the policy error | **DONE** | `tests/problems/policy.test.ts` — 19 tests, incl. that the gate reads `source_type` from the DATABASE so a forged `sourceType` in the payload cannot bypass it         |
| Admin form rejects the same payload on both client and server             | **DONE** | One schema in `lib/problems/schemas.ts`, parsed in `NewProblemForm` and again in `actions.ts`                                                                          |
| Archived problems disappear from the public list but keep user history    | **DONE** | `pagination.test.ts` (hidden by default, visible with `includeHidden`) + `policy.test.ts` (archiving leaves `user_problems` untouched)                                 |

### Criteria this ticket also closed, carried over from F0.4

| Criterion                             | Status                  | Evidence                                                                    |
| ------------------------------------- | ----------------------- | --------------------------------------------------------------------------- |
| Every list route has a skeleton state | **DONE** (was DEFERRED) | `app/(app)/problems/loading.tsx` — `/problems` is the first real list route |

Keyboard traversal remains **PARTIAL**: `/problems` now has interactive rows, but
no spec yet tabs through them. Carried to F0.5, which adds a second surface.

### Found while building

The catalog list was doing a **sequential scan at 20k rows** despite a
correct-looking index, because Drizzle writes `DESC NULLS LAST` and a bare
`ORDER BY ... DESC` means `NULLS FIRST`. Results were identical, so only an
EXPLAIN assertion could catch it. 27.98 ms → 0.27 ms. See decisions **D10**.

---

## F0.5 · `profile-avatar`

| Criterion                                                                | Status           | Evidence                                                                                                                          |
| ------------------------------------------------------------------------ | ---------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| A PDF renamed `avatar.png` is REJECTED at confirm and the object deleted | **DONE**         | `tests/profile/avatar.test.ts` — asserts both the rejection code and that the key is gone from storage                            |
| A 5MB file is rejected at presign, before any upload begins              | **DONE**         | Same suite; also asserts zero keys exist afterwards                                                                               |
| A presigned URL is unusable 90 seconds after issue                       | **DONE**         | Injected clock against the in-memory provider, which implements real expiry                                                       |
| User A cannot presign/confirm under User B's prefix                      | **DONE**         | Called at the **service**, not through the UI; also asserts B's object survives A's attempt                                       |
| Replacing an avatar leaves exactly ONE object                            | **DONE**         | Same suite                                                                                                                        |
| Passing `avatarUrl` in the profile save payload is ignored               | **DONE**         | `tests/profile/profile.test.ts` — schema-level and end-to-end against the DB                                                      |
| A user with no avatar sees initials, identical colour across reloads     | **DONE**         | FNV-1a over the user id; determinism and all-360-hue contrast asserted                                                            |
| A bio containing `<script>` renders as visible plain text                | **PARTIAL**      | Stored verbatim and asserted; React escapes at render. **No browser test yet** — belongs with the F0.3 amendment's e2e work       |
| Profile save on throttled slow-3G rolls back correctly                   | **NOT VERIFIED** | Optimistic save has a 10s timeout and rolls back to the last server-confirmed state, but no Playwright throttling test exists yet |

### Blocked and deferred

- **No live bucket has ever been exercised.** Creating a Cloudflare or Supabase
  account is outside what this environment can do. The always-on contract tests
  prove the CLIENT signs a 60-second expiry correctly; the
  `STORAGE_INTEGRATION=1` suite proves the SERVER honours it, and it has not
  run. Five live assertions are written and skipping.
- **Orphan cleanup is not scheduled.** `cleanupOrphanedAvatars` is written and
  tested; wiring it to a repeating queue is **DEFERRED to F2.3**.

### The provider changed mid-ticket

Supabase Storage was replaced by Cloudflare R2 (S3-compatible) because
`createSignedUploadUrl` accepts **no expiry parameter** — the in-memory fake was
strictly more capable than the vendor, so the 90-second criterion passed in CI
while being false in production. Full reasoning in **decisions D11**.

### Found while building

`AVATAR_LIGHTNESS` was first set to 32%, which looked fine and **failed WCAG**:
pure yellow (hue 60) measured **3.96:1** against white text, and roughly a sixth
of the hue wheel was below 4.5. Because the hue derives from the user id, the
failure would have hit an arbitrary, unpredictable subset of users. Corrected to
28% (worst hue now 4.93:1). The test walks all 360 hues, so a future palette
tweak fails the build.
