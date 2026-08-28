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

| Criterion                                                      | Status                    | Evidence                                                                                                                                                                                                                                                  |
| -------------------------------------------------------------- | ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Every nav item reachable by keyboard with a visible focus ring | **DONE** (F0.3 amendment) | `e2e/keyboard.spec.ts` — 7 tests. Closed at the third attempt; see the note below for what it found and what it deliberately does not claim                                                                                                               |
| Measured contrast documented in code, ≥4.5:1 body text         | **DONE**                  | `npm run contrast` (CI step) + `tests/design/tokens.test.ts`; numbers pasted into `styles/tokens.css`. `border` failed at 2.46/2.52 and was changed, not waived                                                                                           |
| Layout intact at 375px, 768px, 1440px                          | **DONE**                  | `e2e/viewports.spec.ts` — no horizontal overflow, exactly one nav visible and the correct one per width, nothing past the right edge                                                                                                                      |
| **Every list route has a skeleton state**                      | **DEFERRED → F1.1**       | **There are no list routes yet.** Only `/dashboard` has a `loading.tsx`. The primitives exist (`Skeleton`, `CardSkeleton`, `StatGridSkeleton`, `TableSkeleton`) but the criterion is currently **vacuous** and is recorded as deferred rather than passed |
| Theme switches via `data-theme` with no flash of wrong theme   | **DONE**                  | `e2e/theme.spec.ts` asserts the _mechanism_: the bootstrap script is inline, in `<head>`, neither `async` nor `defer`, and the attribute is applied by document commit. A final-state assertion cannot detect a flash                                     |
| `grep` for hex colours in `components/` returns nothing        | **DONE**                  | `tests/design/tokens.test.ts` walks `components/` and `app/`, rejecting hex, `rgb()` and `hsl()`                                                                                                                                                          |

---

## Open, carried forward

1. ~~**Keyboard traversal** (F0.4)~~ — **closed** by the F0.3 amendment, see below.
2. **Magic-link delivery** (F0.3) stays BLOCKED until a Resend key exists.
3. ~~**Skeleton coverage** (F0.4)~~ — **closed** by F1.1's `/problems`.

### Closing the keyboard criterion

It was PARTIAL through F0.4, carried through F1.1 and F0.5. `e2e/keyboard.spec.ts`
now tabs the full signed-out flow (`/login` → check-email panel → `/login/verify`
error state → `/onboarding`) and one authenticated surface with real interactive
rows (`/problems`), asserting three separate claims at every stop: **order**,
**no trap** (Shift+Tab moves focus back), and a **visible ring** read from the
focused element's computed style rather than from the stylesheet.

**It found a real defect.** The resend control was `disabled` during its
60-second cooldown, which removes an element from the tab order entirely — a
keyboard user mid-cooldown finds the button has silently vanished with no
explanation. Both resend buttons now use `aria-disabled` and guard the handler;
the server enforces the cooldown regardless, so a press during the window is
answered rather than obeyed. The variant was verified as emitted CSS
(`aria-disabled\:opacity-60[aria-disabled=true]`) rather than assumed, since a
Tailwind class that compiles to nothing is the D12 pattern exactly.

**Three test bugs were fixed rather than worked around**, each of which would
have made the spec pass while proving less than it claimed:

| Bug                                    | Why it mattered                                                                                                                     |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `body.click({x:1,y:1})` to reset focus | Lands ON the `sr-only` skip link, so the first Tab moved _past_ the element under test                                              |
| `activeElement.blur()` to reset focus  | Clears the active element but **not** Chromium's sequential-navigation starting point, so tabbing resumed mid-page                  |
| `?? ` chain building the focus label   | `el.id` is `''`, not `null`, so the chain stopped there and every label was empty — the reachability matchers were matching nothing |

**What it does not claim:** this is Chromium only, and it asserts a ring exists
(non-zero outline or box-shadow), not that the ring meets a contrast ratio
against its background. Screen-reader announcement is not asserted at all.

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

Keyboard traversal was still **PARTIAL** at this point — `/problems` had the
interactive rows but no spec tabbed through them. It is **closed** by the F0.3
amendment, which uses `/problems` as its authenticated surface.

### Found while building

The catalog list was doing a **sequential scan at 20k rows** despite a
correct-looking index, because Drizzle writes `DESC NULLS LAST` and a bare
`ORDER BY ... DESC` means `NULLS FIRST`. Results were identical, so only an
EXPLAIN assertion could catch it. 27.98 ms → 0.27 ms. See decisions **D10**.

---

## F0.5 · `profile-avatar`

| Criterion                                                                | Status           | Evidence                                                                                                                                                                                                             |
| ------------------------------------------------------------------------ | ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A PDF renamed `avatar.png` is REJECTED at confirm and the object deleted | **DONE**         | `tests/profile/avatar.test.ts` — asserts both the rejection code and that the key is gone from storage                                                                                                               |
| A 5MB file is rejected at presign, before any upload begins              | **DONE**         | Same suite; also asserts zero keys exist afterwards                                                                                                                                                                  |
| A presigned URL is unusable 90 seconds after issue                       | **DONE**         | Injected clock against the in-memory provider, which implements real expiry                                                                                                                                          |
| User A cannot presign/confirm under User B's prefix                      | **DONE**         | Called at the **service**, not through the UI; also asserts B's object survives A's attempt                                                                                                                          |
| Replacing an avatar leaves exactly ONE object                            | **DONE**         | Same suite                                                                                                                                                                                                           |
| Passing `avatarUrl` in the profile save payload is ignored               | **DONE**         | `tests/profile/profile.test.ts` — schema-level and end-to-end against the DB                                                                                                                                         |
| A user with no avatar sees initials, identical colour across reloads     | **DONE**         | FNV-1a over the user id; determinism and all-360-hue contrast asserted                                                                                                                                               |
| A bio containing `<script>` renders as visible plain text                | **DONE**         | `e2e/profile.spec.ts` — real browser. Asserts the payload is a field VALUE, that no script element's body IS the payload, and registers a `dialog` handler as a positive control that would fire if it ever executed |
| Profile save on throttled slow-3G rolls back correctly                   | **NOT VERIFIED** | Optimistic save has a 10s timeout and rolls back to the last server-confirmed state, but no Playwright throttling test exists yet                                                                                    |

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

---

## F0.3 amendment · `auth-ui`

Reopened F0.3's UI scope: `/login`, `/login/verify`, `/onboarding`, a signed-out
layout, and `returnTo` validated against a same-origin allowlist. The shipped
route before this was `/sign-in`, and `/onboarding` did not exist.

| Criterion                                                  | Status      | Evidence                                                                                                                                                                                              |
| ---------------------------------------------------------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/login` sends a magic link and shows a check-email state  | **DONE**    | `e2e/keyboard.spec.ts` submits by keyboard alone and asserts the panel replaces the form                                                                                                              |
| Magic-link delivery reaches a real inbox                   | **BLOCKED** | Needs `RESEND_API_KEY`. The e2e server logs a real Resend 401 — the call is genuinely made, only delivery is unverified                                                                               |
| A link expires 15 minutes after issue                      | **DONE**    | `tests/auth/onboarding.test.ts` — four states asserted against a real DB. 15 min is **our** number, not an Auth.js default (24h); see **D13**                                                         |
| The four link states are distinguishable                   | **DONE**    | Same suite — `valid` / `expired` / `used` / `invalid`, incl. used-AND-expired reading as `used`. Only possible because consumption **marks** rather than deletes                                      |
| A consumed link cannot be replayed                         | **DONE**    | `e2e/auth-flow.spec.ts` — replay after `clearCookies` mints no session cookie. Enforced by an atomic `UPDATE … WHERE consumed_at IS NULL … RETURNING`                                                 |
| The 60s resend cooldown cannot be bypassed                 | **DONE**    | Both `/login` and the expired-link `ResendPanel` call the ONE server action in `app/(auth)/login/actions.ts`. The countdown is a _display_ of the server's value, never the control                   |
| `returnTo` rejects off-origin and malformed input          | **DONE**    | `lib/auth/return-to.ts`, 7 steps; raw control characters checked **before** parsing because WHATWG `URL` silently strips tab/LF/CR. `e2e/onboarding.spec.ts` covers the open-redirect case end to end |
| `/admin` as a `returnTo` is gated on role at redirect time | **DONE**    | `e2e/onboarding.spec.ts` — admin lands on `/admin`, non-admin lands on `/dashboard` with no 403                                                                                                       |
| `/onboarding` decides completion via `hasCompletedProfile` | **DONE**    | `tests/auth/onboarding.test.ts` asserts the route wrapper and the layout predicate agree for every **storable** shape, so they cannot drift into a redirect loop                                      |
| The onboarding gate holds against direct navigation        | **DONE**    | `e2e/onboarding.spec.ts` — 10 tests, all typing URLs rather than clicking through                                                                                                                     |
| Full keyboard traversal, order + no trap + visible ring    | **DONE**    | `e2e/keyboard.spec.ts` — see "Closing the keyboard criterion" above                                                                                                                                   |

### Found while building

**`/onboarding` had no auth guard.** It lives in the `(auth)` route group, which
has no layout-level session check, so `requireCurrentUser()` threw and an
anonymous visitor typing the URL got a **500 instead of a redirect**. The UI
flow was correct throughout; only direct navigation exposed it. This is why the
review asked for direct-navigation tests rather than click-through tests, and it
is the same lesson as the stale-session 401: assert at the layer the criterion
names.

**The onboarding gate discarded the user's destination.** `app/(app)/layout.tsx`
called `redirect('/onboarding')` with no `returnTo`, even though `/onboarding`
honours one — so a first-time user following a link to `/problems` finished
onboarding on `/dashboard` and the destination was silently lost. A Next layout
is not given the pathname, so middleware now forwards it as a request-only
header and the layout re-validates it through the same allowlist. Pinned by
"the gate defers the destination rather than discarding it" in `e2e/auth-flow.spec.ts`.

**A whitespace-only display name is storable.** `'   '` is three characters, so
the `user_profiles_display_name_length` CHECK (2–40) accepts it; only
`isProfileComplete` trims. Had the route gate and the predicate used different
rules, that exact input would have bounced the user between `/onboarding` and
`/dashboard` forever. Asserted in both the unit and the e2e layer.

### Not done

- **Magic-link delivery** — BLOCKED on `RESEND_API_KEY`, unchanged.
- **Phone OTP UI** — the service and `/settings/phone` exist; the amendment did
  not ask for an OTP step in the signed-out flow and none was built.
- **Keyboard spec is Chromium-only** and asserts a ring _exists_, not that it
  meets a contrast ratio. Screen-reader announcement is not asserted.

---

## F1.2 · `bulk-ingest`

| Criterion                                                                             | Status                  | Evidence                                                                                                                                                                                                                           |
| ------------------------------------------------------------------------------------- | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A CSV with 3 malformed rows shows 3 row-level errors and still imports the valid rows | **DONE**                | `tests/ingest/csv.test.ts` (parse layer) + `tests/ingest/import.test.ts` (committed row count). The preview renders them before anything is written                                                                                |
| The same URL in a different surface form is detected as a duplicate                   | **DONE**                | `tests/ingest/normalise-url.test.ts` — 47 cases — plus an integration test importing http/www/trailing-slash/`?ref=`/`/description/` variants and asserting one row                                                                |
| A 500-row file runs as a job with visible progress and does not block the request     | **DONE, with a caveat** | `tests/ingest/jobs.test.ts` asserts the POST returns before any row is imported, and POLLS DURING the run requiring strictly-increasing intermediate values. **The runner is in-process, not a queue** — see the row below and D17 |
| Export → import round trip produces zero new rows                                     | **DONE**                | `tests/ingest/export.test.ts` runs the cycle **twice**; the criterion is a second-lap claim                                                                                                                                        |
| 100-problem library, every row has a working URL and ≥1 pattern tag                   | **BLOCKED / PARTIAL**   | See below — this one is split three ways and none of them is "done"                                                                                                                                                                |

### The library criterion, split honestly

| Part                            | Status         | Why                                                                                                                                                                                                                                                 |
| ------------------------------- | -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 100 problems                    | **BLOCKED**    | 34 ship. Reaching 100 means generating URLs from memory; a plausible-looking URL that 404s is a broken link with our name on it, and inventing platform content is what C1 forbids. Blocked on a real list                                          |
| ≥1 pattern tag per row          | **DONE**       | `tests/ingest/library.test.ts`, over every row present                                                                                                                                                                                              |
| Every row has a **working** URL | **UNVERIFIED** | `npm run library:verify` exists and runs. **LeetCode returns 403 to automated requests**, so all 34 report BLOCKED — not broken, not working, unknown. A browser User-Agent would get past it and that is evading bot protection, so it is not done |

What _is_ verified about the URLs is weaker and worth stating exactly: every URL
is **derived** from a slug matching the canonical pattern, never hand-typed, so
no row can carry a typo'd link. That rules out the failure the script was
written to catch. It does not confirm the pages exist.

### The job criterion, stated as what was built

F2.3 `job-runtime` is cut, so "runs as a job" is satisfied by a state machine in
Postgres driven by an in-process runner. Recording it as plain DONE would be
true of the words and false about the system. What that costs:

- **No automatic retry.** A job whose process dies is dead until a user acts.
  Recovery is re-uploading the same file, which re-enqueues it idempotently —
  asserted in `tests/ingest/jobs.test.ts`.
- **No scheduled sweep.** `sweepStalledJobs` runs only when called.
- **Stall detection covers two shapes**: `running` with a stale heartbeat, and
  `pending` that never started — the second was invisible until the re-upload
  path was written.

### Found while building

**The slug collision.** Imported slugs were a deterministic hash of the
normalised URL, which collided under the partial unique index that deliberately
lets an archived and a live problem share a URL. An untargeted
`onConflictDoNothing()` then swallowed that collision exactly like a dedup race,
so the row came back neither created nor findable. Two defects, the second only
visible after the first. **D16**.

**The escape/unescape pair was not an inverse.** CSV-injection escaping stripped
its marker whenever the next character was a formula lead, so a title genuinely
typed as `'=x` came back as `=x` — a one-time silent data change that then
stabilised and looked correct forever. Invisible to a fresh-value round-trip
test; only a second lap shows it.

**The caps are not independent.** The `maxRows` test was passing while actually
exercising the byte cap: at realistic widths a 100k-row CSV exceeds 2 MiB, so it
was rejected for size and the test asserted the wrong limit while looking right.

**A seam that would have failed only under its replacement.** `enqueue(jobId)`
was justified by "the payload is already in the database" — it was not. Every
test passed because every test ran in-process.

---

## F1.3 · `streak-engine`

| Criterion                                                          | Status   | Evidence                                                                                                                                                                                                            |
| ------------------------------------------------------------------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A solve at 23:59 IST counts for that IST day, not the next UTC day | **DONE** | `tests/streak/day.test.ts` — the criterion by name, plus 00:01 IST, 23:59 New York, a 45-minute offset zone, and a cross-check asserting **Node and Postgres resolve the same instant to the same date**            |
| DST tests pass with no off-by-one day                              | **DONE** | `tests/streak/day.test.ts` — spring-forward, fall-back, and a 25-hour day, all America/New_York. The ambiguous repeated hour is asserted explicitly rather than left as an assumption inside a passing test         |
| Recompute run twice yields byte-identical state                    | **DONE** | `tests/streak/recompute.test.ts` — asserted on the **full row including `updated_at`**, with a positive control proving the assertion can fail. `recomputeStreak` compares before writing so a no-op writes nothing |
| Freeze consumption appears in the log with the covered date        | **DONE** | `tests/streak/recompute.test.ts` reads `streak_freezes.covered_local_date` back from the database                                                                                                                   |
| Backfilling a past session correctly extends or repairs the streak | **DONE** | `tests/streak/recompute.test.ts` — a late session repairs the chain **and releases the freeze that was covering the gap**, because coverage is re-derived rather than transacted (D18)                              |
| Heatmap renders 365 cells with correct per-day counts              | **DONE** | `tests/streak/heatmap.test.ts` — exact cell count, days with no row filled rather than skipped, per-day counts, a leap day, and no cross-user leakage                                                               |

Tests: **112 passing across 7 files** in `tests/streak/` — `day`, `rules`,
`goals`, `recompute`, `heatmap`, `summary`, `timezone-change` — plus
`e2e/goals.spec.ts` (3 browser tests). Full suite at closure: **583 passing, 5
skipped, 45 Playwright**.

### A decision record was asserting something that was not true

**D18 claimed "a test asserts that copy exists" about the timezone note. No such
test existed.** The behaviour was right, the copy was on the page, and the
sentence in the decision record was false — which is worse than an untested
mitigation, because the next person reads it and stops checking.

It is now `e2e/goals.spec.ts`, and it is a browser test because the claim is
about **when** the text appears: on change, before submit. That is a rendering
behaviour, not a return value. It also asserts the note is wired to the field by
`aria-describedby` rather than merely sitting near it — otherwise a screen-reader
user moving field to field never meets the explanation at all.

### The case the ticket asked for by name, and it was missing

The spec's test list includes _"a user changing their timezone mid-streak —
**define and test the chosen behaviour, do not leave it accidental**"_. The
behaviour was defined (D18), the settings copy was written from it and the
recompute was built around it — but **nothing asserted it**. It is now
`tests/streak/timezone-change.test.ts`, and writing it surfaced a cost worth
stating plainly:

**Moving east spends a freeze on a day the user never lived.** New York →
Kolkata moves the local date forward, so a calendar date can be skipped
entirely. To the engine that date is a settled day with no activity —
indistinguishable from a day the user skipped — so a freeze covers it and the
streak survives at six. That is correct under D18 (history is immutable, so the
engine cannot know the day was never available) and it is still a freeze the
user did not choose to spend. Asserted, so a future change to freeze handling
has to confront the case rather than discover it in production, where the
symptom is a balance that dropped for no visible reason.

### The shell now shows real numbers

F0.4 built the streak badge and the goal ring as pure props and left the layout
passing `streakDays: 0`, with a standing note that F1.3 would supply the values.
It does, through one call — `summariseForShell` — so the components still never
query.

| Decision                                                    | Why                                                                                                                                                                                                                        |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The shell **recomputes** rather than reading the stored row | The stored number ages overnight with nothing to age it, and whether a freeze covers a missed day is decided _by_ the recompute. Reading it would show a streak that has already broken, on the most-visited surface (D19) |
| `goalMet` travels beside `goalCompleted`                    | The revision arm completes a day at one solve, so the count can sit below the target on a day that is done. Rounding the count up lies; showing `1 of 2` alone contradicts the badge next to it                            |
| `atRisk` requires `currentStreak > 0`                       | The flag turns the badge warning-coloured. On a zero streak that is an alarm about nothing, which is how a colour teaches people to stop reading it                                                                        |

`IS SAFE TO CALL ON EVERY PAGE LOAD` in `tests/streak/summary.test.ts` asserts
the claim that makes this defensible: two calls in a row return the same value
and leave the full `user_streaks` row byte-identical, `updated_at` included.

### Found while building

**A freeze was being spent on today.** Today is not a missed day — the user has
the rest of it — so offering it to the freeze logic burned one on every
recompute and drained the monthly allowance in two days. The symptom was a
five-day run reading as six.

**A test asserted a bug that was not there.** "Yesterday being incomplete breaks
the streak" used two settled misses, which is exactly the monthly allowance, so
the chain correctly survived. Every previous finding in this project has been
the code being wrong; this is the first where the expectation was wrong — and
had the implementation happened to match it, correct behaviour would have been
"fixed". **D18**.

**`Intl` silently remaps legacy abbreviations.** `EST` resolves to
`America/Panama`, which has no DST, so a user stored that way would be an hour
out for half the year with nothing pointing at the cause. Abbreviations are
rejected; only `Area/Location` and `UTC` are accepted.

**Three copies of "which target applied".** The recompute, the heatmap and the
shell each carried their own effective-date walk and their own literal `2`.
Nothing would have failed if one drifted — the symptom would have been the
heatmap disagreeing with the streak drawn directly above it. Now one function,
`targetOn` in `server/services/streak/goals.ts`, with `tests/streak/goals.test.ts`
covering it directly. **D19**.

**Two project guards fired, and both were right.** The client/server boundary
rejected `components/heatmap` importing a type from `server/` — fixed by moving
the contract to `lib/streak/heatmap-day.ts`, not by widening the gate. The
design-token rule rejected the freeze hatch three times, once on the _comment_
explaining the first two rejections; reworded rather than loosened.

---

## F1.4 · `session-timer`

| Criterion                                                                    | Status                  | Evidence                                                                                                                                                                                                                                                                                                        |
| ---------------------------------------------------------------------------- | ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Close the tab for 2 minutes, reopen: elapsed time is correct                 | **DONE**                | `e2e/session.spec.ts` reloads a real browser after the session's start is moved 20 minutes into the past, and reads the count back off the bar. `tests/session/lifecycle.test.ts` asserts the same at the service layer, and `duration.test.ts` isolates why: a heartbeat gap is not an input to the arithmetic |
| Forged client duration is ignored (test proves it)                           | **DONE**                | Two layers. `tests/session/adversarial.test.ts` forges ten field names against every schema and asserts none survive `parse`; `e2e/session.spec.ts` POSTs the same forgery to `/api/session/heartbeat` **with a real session cookie** and asserts the stored timestamps are still this year                     |
| A second startSession while one is active returns a conflict, not a new row  | **DONE**                | `tests/session/lifecycle.test.ts` (also for a merely PAUSED session), `tests/session/schema.test.ts` for the partial unique index behind it, and `e2e/session.spec.ts` for the message the user actually sees                                                                                                   |
| Pause/resume across three cycles produces arithmetically correct active time | **DONE**                | `tests/session/lifecycle.test.ts` — 60 minutes wall, 3 + 4 + 5 paused, asserted as 48 minutes **and** as the exact event sequence                                                                                                                                                                               |
| No heartbeat for 5 minutes produces an idle_autopause event                  | **DONE**                | `tests/session/lifecycle.test.ts`, including that the event is stamped at the last heartbeat rather than at discovery, and that it does not fire while heartbeats keep arriving                                                                                                                                 |
| A 7-hour-old active session is auto-closed by the cleanup job                | **DONE, with a caveat** | `tests/session/lifecycle.test.ts` — closed, with `ended_at` at the last heartbeat. **There is no cleanup JOB** — see below                                                                                                                                                                                      |

Tests: **97 across 5 files** in `tests/session/` — `schema`, `duration`,
`state`, `lifecycle`, `adversarial` — plus `e2e/session.spec.ts` (5 browser
tests). Full suite at closure: **680 passing, 5 skipped, 50 Playwright**.

### The cleanup-job criterion, stated as what was built

F2.3 is cut, so "auto-closed by the cleanup job" is satisfied by a sweep on the
request path plus `npm run sessions:sweep`. Recording it as plain DONE would be
true of the words and false about the system (**D20**). What it costs:

- **Nobody else's session is closed until a human acts.** The shell closes the
  CURRENT user's stale session for free — it had already loaded it to draw the
  timer — but a user who never returns keeps a live row until the script runs.
- **Nothing is blocked by that.** The owner's own next page load sweeps it
  before the "one live session" check, so a dead session can never lock someone
  out of starting a new one. That is asserted.
- **The only distortion is a count of live sessions**, which nothing yet reads.

### What the ticket asked to be adversarial about

The requirement was a test that posts a forged duration and timestamp to every
endpoint. It passes for a reason worth stating: **no schema has a field for
either**, so the forgery is dropped by `parse` rather than rejected by a check.

Two positive controls guard against that passing vacuously — one asserts the
forged-field list is not empty, the other proves the duration genuinely tracks
the server's clock by moving it honestly. The forged names live beside the
schemas, not in the test, so the two cannot drift.

### Found while building

**A raw `sql` fragment will not take a `Date`.** Eight lifecycle tests failed
inside the ON CONFLICT half of the attempt upsert with "the string argument must
be of type string, received an instance of Date". Inside a raw fragment drizzle
hands the value to the driver without the column's encoder — the same `Date`
works two lines earlier in the typed builder. Fixed with an ISO string and an
explicit `::timestamptz`.

**The schema caught the first test fixture.** Four constraint tests failed on
`solve_sessions_ends_after_start` because the fixture left `started_at` to the
column default while setting `ended_at` from `new Date()` — mixing the database's
clock with Node's, so every "finished" row ended before it started. The
constraint was right and the test was wrong.

**The boundary guard rejected `app/(app)/session-actions.ts`.** The exemption is
by PATH and the path is `app/**/actions.ts`. Moved into its own folder rather
than widening a pattern that guards what reaches the client bundle — the same
call as F1.3's heatmap type.

**A test that asserted nothing, again.** The first "close the tab for 2 minutes"
duration test computed the same expression twice and compared them. It now
asserts the contrast that is the actual claim: a gap below the idle threshold
costs nothing, a gap above it costs exactly the idle interval.

### Not done

- **Confidence is captured but not prompted for.** `completeSession` stores it
  and the timer bar does not ask — the post-solve reflection form is F1.5, and
  inventing a confidence prompt here would be the wrong shape to replace later.
- **`session_events` is append-only by convention, not by enforcement.** Nothing
  updates or deletes a row, and the duration arithmetic depends on that; F3.2
  adds the database-level rejection its own criterion requires.

---

## F1.5 · `reflection-capture`

| Criterion                                                                                                                     | Status   | Evidence                                                                                                                                                                                                           |
| ----------------------------------------------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Three stuck markers in one session all persist with distinct elapsed times                                                    | **DONE** | `tests/reflection/stuck.test.ts` — three markers at 2, 11 and 26 minutes, asserted as elapsed values and categories. A second test proves the elapsed figure EXCLUDES paused time, like every other duration (D20) |
| Reflection mistake categories are queryable with a WHERE clause on an enum column — no JSON extraction for any taxonomy field | **DONE** | `tests/reflection/schema.test.ts` runs the criterion's own sentence as SQL, **and** reads `information_schema` to assert `reflections.extras` is the only jsonb column across all four tables                      |
| Skipping the reflection completes the session cleanly                                                                         | **DONE** | `tests/reflection/reflection.test.ts` asserts no row, session still `solved`, and the day still credited; `e2e/reflection.spec.ts` walks the browser through Skip                                                  |
| Reopening a solved problem shows the last attempt panel with real data                                                        | **DONE** | `tests/reflection/history.test.ts` asserts duration, outcome, confidence, markers, mistakes and approach; `e2e/reflection.spec.ts` reads them off the rendered page                                                |
| Attempt timeline ordering is correct across a backfilled past session                                                         | **DONE** | `tests/reflection/history.test.ts` inserts a session dated a week earlier AFTER two recorded today, and asserts it becomes attempt 1 and renumbers the others                                                      |

Tests: **37 across 4 files** in `tests/reflection/` — `schema`, `stuck`,
`reflection`, `history` — plus `e2e/reflection.spec.ts` (5 browser tests). Full
suite at closure: **718 passing, 5 skipped, 55 Playwright**.

### Not done — the "hints used" column

IN SCOPE item 1 lists hints in the attempt timeline. **There is no source for
it.** Hints come from F3.4 `ai-gateway`, which is cut from the target scope, and
F3.2's `hint_requested` event only records that one was asked for by something
that does not exist.

Rendering the column would mean an empty cell on every row forever — a promise
the product cannot keep. It is left out and recorded here, the same way F1.2's
library criterion was split rather than rounded up.

### Found while building

**A sub-second solve failed the entire completion.** `user_problems_best_time_positive`
requires `best_time_seconds > 0` and the duration floors to whole seconds, so
finishing in under a second stored 0, Postgres rejected the upsert, and the user
got a 500 on the one click meant to record their work — session still live,
nothing credited.

This is an **F1.4 bug that F1.4's own tests could not see**: every one of them
set `now` twenty minutes ahead, and the failure is not at a boundary of the
arithmetic but at a boundary of the schema the arithmetic feeds. A browser test
that pressed "Solved" immediately found it. Fixed by recording one second, with
a regression test that completes a session 400ms after starting.

**Two red bars that were my tests, not the code.** An unscoped
`SELECT ... FROM stuck_points` read a leftover row from the unit suite — which
shares this database and truncates at the START of each test — and reported a
category the browser spec never chose. Then the IDOR test read the session id
from `page.url()` and raced, navigating to the problem page and reporting its
200 as a missing 404.

The second one mattered more than the first: "my test is wrong" and "there is an
IDOR" look identical from a failure. The server's 404 was verified independently
before anything was changed.

### What F3.3 and F3.5 inherit

- `stuck_points.source` already distinguishes `user` from `inferred`, so F3.3's
  "confirmed and inferred are separable in a single SQL query" needs no
  migration and no backfill of assumptions.
- A skipped reflection and `mistakes: ['none']` are distinguishable, which F3.5
  depends on: conflating them would make every skipped question read as a clean
  solve.
- Abandoned sittings appear in the timeline without an attempt number, so the
  timeline and `user_problems.total_attempts` cannot disagree.

---

## F1.6 · `analytics-core`

| Criterion                                                          | Status                  | Evidence                                                                                                                                                                                                                                                  |
| ------------------------------------------------------------------ | ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dashboard renders in <500ms on the six-month dataset               | **DONE**                | `tests/analytics/dashboard.test.ts` — **4.7ms** over 235 sessions across 180 days, from a fixed seed so the figure is reproducible. A second test empties the rollup and asserts the page reports zero, proving the read never falls back to raw sessions |
| Weak-topic formula documented in code with named weights           | **DONE**                | `WEAK_TOPIC_WEIGHTS` in `server/services/analytics/scoring.ts`, with the ordering argued in the comment block; prose in `docs/scoring.md`. Tests isolate each component at its maximum and assert the score equals exactly 100 × that weight              |
| Every weak-topic row surfaces a human-readable reason              | **DONE**                | `tests/analytics/scoring.test.ts` (never empty, ordered by contribution, names its numbers), `dashboard.test.ts` at the service layer, and `e2e/analytics.spec.ts` reading the rendered panel                                                             |
| Rollup job is idempotent: two runs for one day produce one row set | **DONE, with a caveat** | `tests/analytics/rollup.test.ts` — two runs, then four, byte-compared with a positive control. **There is no job** — see below                                                                                                                            |
| Nowhere in the codebase or UI is this called AI or a prediction    | **DONE**                | Two guards at two layers: `tests/analytics/wording.test.ts` greps service, components, page and `docs/scoring.md`; `e2e/analytics.spec.ts` greps the **rendered** page. Both carry positive controls                                                      |

Tests: **59 across 4 files** in `tests/analytics/` — `scoring`, `rollup`,
`dashboard`, `wording` — plus `e2e/analytics.spec.ts` (5 browser tests). Full
suite at closure: **777 passing, 5 skipped, 60 Playwright**.

### The "rollup job" criterion, stated as what was built

F2.3 is cut, so `jobs/analytics-rollup.processor.ts` does not exist and `jobs/`
stays empty. The rollup is kept current by two things instead (D17, D22):

- **the request path**, which tops up the current user's stale days on load,
  capped at 30. In steady state that is one day — today — because yesterday was
  rolled up yesterday.
- **`npm run analytics:rollup`**, which rebuilds a window for every user, on
  demand, resolving each user's "today" in their own timezone (D18).

What that costs: a user with months of history behind them catches up over two
or three visits rather than one, and the page says "still catching up on older
days" while that is true. Nobody else's rollup advances until a human runs the
script.

### The performance number, and what makes it honest

4.7ms is the read only, and the read is four queries against the rollup. The
first load of a cold account also pays for the top-up, which is why the cap
exists — that path is bounded, not free, and the acceptance figure is not
claimed for it.

The dataset is generated from a fixed seed rather than randomly. A perf test on
random data fails on the unlucky run and cannot be reproduced, which teaches a
team to re-run red builds until they go green.

### Found while building

**Three freshness tests failed because two clocks were being compared.** The
rollup stamped `computed_at` from the caller's `now` while staleness compared it
against `solve_sessions.updated_at`, which Postgres writes — so every day
reported itself stale forever. The rows now omit the column and let its default
fire. Same class of mistake the F1.4 schema caught in a test fixture, arriving
from the other direction.

**A positive control failed, correctly.** The six-month generator produces 235
sessions; the control asserted more than 300. The threshold was a hopeful round
number rather than the generator's real output — and a control failing that way
is the useful direction, because it means the number is being read rather than
assumed.

### A failure that looked like a keyboard regression

The full browser suite went red on `e2e/keyboard.spec.ts` — "/problems traverses
in order" — the moment this ticket's spec was added. Nothing about the keyboard
had changed.

**The catalog is shared by every spec in the suite**, and three specs (F1.4's,
F1.5's and this one) each created a fixture problem and never removed it. That
spec tabs through `/problems` with a budget of stops, and three extra rows was
enough to push its own rows out of reach.

Fixed by making each of those specs delete its fixtures in `afterAll` rather
than only before each test. **Worth knowing before adding another browser spec:**
any spec that inserts a problem changes what `/problems` renders for every other
spec, and the keyboard test is the one that notices.

### Not done

- **Recharts is not used**, though the locked stack names it. Two charts of
  fifteen rectangles do not justify a client-side charting dependency on a page
  whose point is to be cheap; `/analytics` ships 163 B of route JS as a result.
  Recorded as a deliberate deviation in **D22**, not an oversight.
- **The dashboard's "Due for revision" card is gone**, not zeroed. F2.1 owns
  that queue; a `0` would claim nothing is due, which is a different statement
  from "this has not been built".
