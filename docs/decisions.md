# Decision record

Decisions that cost something, or that a future reader would otherwise
reasonably undo. Each states the alternative rejected and what breaks if the
decision turns out wrong.

---

## D1 · `experimental.authInterrupts` is ON, deliberately

**Status:** active · **Flag:** `next.config.ts` → `experimental.authInterrupts: true`
**Depends on:** Next.js 15 experimental API

### What it enables

`unauthorized()` and `forbidden()` from `next/navigation`. They abort rendering
and return a real **401** / **403**, rendering `app/unauthorized.tsx` and
`app/forbidden.tsx`.

### Why it is on

F0.3's acceptance criterion is _"A non-admin hitting /admin gets 403, not a
redirect loop."_ That is a statement about a **status code**, and there are only
three ways to produce it in the App Router:

| Option                                           | Result                                                                                                                                                    |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `redirect('/sign-in')`                           | **Fails the criterion.** Redirecting an already-authenticated user to sign-in is precisely the loop the ticket names.                                     |
| Throw a custom error and catch it in `error.tsx` | `error.tsx` always responds **500**. The page could _say_ "403" while the status line said otherwise — worse than useless for an API client or a monitor. |
| `forbidden()`                                    | Returns a true 403 with a rendered page.                                                                                                                  |

Verified over real HTTP (`scripts/verify-admin-403.ts`), not inferred:

```
anonymous    /admin → 307 → /sign-in?callbackUrl=%2Fadmin
NON-ADMIN    /admin → 403
admin        /admin → 200
stale cookie /admin → 401
```

### What breaks if the API changes or is removed

The blast radius is deliberately small — **three files**:

- `app/admin/layout.tsx` — the only caller of `forbidden()`
- `app/(app)/layout.tsx` — the only caller of `unauthorized()`
- `app/forbidden.tsx`, `app/unauthorized.tsx` — the rendered bodies

Authorization **logic** does not depend on the flag at all. It lives in
`server/services/auth/rbac.ts` as `requireRole()` / `hasRole()`, which throw
typed `AuthenticationError` (401) and `AuthorizationError` (403) carrying their
own `status`. Those are plain classes with no Next.js import, and they are what
the unit tests exercise.

So if the API is renamed, moved to stable, or dropped:

1. Nothing about _who is allowed what_ changes.
2. The two layouts swap `forbidden()` for whatever replaces it. If nothing
   replaces it, the fallback is a route handler or middleware returning
   `new Response(null, { status: 403 })` — more plumbing, same status.
3. **The failure is loud, not silent.** Removing the flag makes
   `forbidden()` throw at runtime rather than degrade to a redirect, and
   `scripts/verify-admin-403.ts` asserts the status directly.

### Rejected alternative

Middleware doing the role check. Rejected because role lives in Postgres and
edge middleware has no database connection — it would need either a JWT claim
(unrevocable when an admin is demoted) or a network hop per request. Middleware
answers _authentication_ only; the layout answers _authorization_.

### Review trigger

Re-evaluate when Next.js marks `authInterrupts` stable, or at F4.8's security
audit, whichever comes first.

---

## D2 · Embedded Postgres, instead of tests that skip

Half of F0.2's acceptance criteria are statements about the _database_ — a CHECK
rejects this insert, a partial unique index permits many NULLs, EXPLAIN chooses
an index. None of that can be verified against a mock, and this machine has
neither Docker nor a system Postgres. The tempting move was to write the suites
so they skip when no database is configured, then call the criteria met on the
strength of the code reading correctly. That would have been a false claim with
a green tick next to it. Instead `embedded-postgres` downloads a real server and
`npm run test:db:start` runs it on port 55432, so the constraint suites execute
locally exactly as they do against the `postgres:16` service container in CI. The
skip path still exists — `npm test` stays green on a fresh clone with no database
— but it is a convenience, never the thing being relied on. The cost is a
devDependency that downloads a binary; the benefit is that "the CHECK rejects it"
is something I watched happen rather than something I asserted.

---

## D3 · The EXPLAIN fixture is sized for selectivity, not row count

The first version of the index test padded the catalog to 2,000 problems and
asserted an index scan. It failed, correctly: with only five topic values any
single topic matched about a fifth of the table, and a sequential scan feeding a
hash join genuinely is cheaper there. The tempting fix is `SET enable_seqscan =
off`, which would have produced a passing test proving nothing except that
Postgres obeys a flag. The real fix was to make the data production-shaped rather
than merely large — 50,000 problems tagged from a 40-value topic vocabulary, so
any one topic is a small slice and the index genuinely wins. Postgres then picks
it unaided. The lesson generalises past this ticket: a query plan is a function
of statistics, so a performance test on unrepresentative data measures nothing at
all. The reasoning lives in the fixture itself so nobody later "simplifies" the
vocabulary back down and quietly invalidates every plan in
`docs/performance.md`.

---

## D4 · The `border` token was changed, not waived

The contrast script's first run showed every text pair passing comfortably and
`border` failing the 3:1 non-text minimum in both themes — 2.46:1 dark, 2.52:1
light. Borders are easy to rationalise away: they are decoration, the design
looked fine, and WCAG 1.4.11 is the clause people skip. The ticket anticipated
exactly that and said change the token, do not waive it, so I searched the grey
ramp for the nearest values clearing 3:1 against both `background` and `surface`
and moved both themes; they now measure 3.31 and 3.34. The wider point is that an
audit only has force if it is permitted to fail something and win. A contrast
check that has never rejected a colour is itself decoration. It now runs in CI,
so the next colour change that drops below a threshold breaks the build instead
of shipping.

---

## D5 · The adapter dilemma was false, and disproving it took two experiments

I claimed the choice was between reshaping the `users` table and hand-writing an
Auth.js adapter, and wrote roughly 150 lines of the latter. That was wrong, and
the reasoning error is worth recording because it is a common one: I treated a
library's TypeScript type as if it were its runtime contract. Drizzle decouples
the property name from the column name, so
`emailVerified: timestamp('email_verified_at')` gives the adapter the key it
demands while the SQL column stays exactly as F0.2 specifies — and regenerating
the migration after that rename produced zero change to `users`, which is the
proof rather than the argument. That left `name` and `image`, which have nothing
to map to. Rather than assume in either direction I ran the stock adapter against
a real database with those columns absent: `createUser` succeeded, because it
does `.values(data)` and Drizzle drops keys that are not columns. The dilemma
dissolved into one documented cast plus a forty-line wrapper for three
app-specific rules, and the security-sensitive parts — session tokens,
verification tokens, account linking — went back to the library that maintains
them. A test fails if a future version starts reading those columns, so the cast
is an asserted assumption rather than a hope.

---

## D6 · `server/db/client.ts` and `server/db/index.ts` are two files on purpose

The worker crashed at boot because it imported `@/server/db`, which carries
`import 'server-only'`, and that package throws unless the `react-server` export
condition is set — which Next sets and plain Node does not. My first fix added
`--conditions=react-server` to the worker script. It worked, and it was the wrong
answer: it disabled the guard for the whole process and made the worker declare
itself an RSC environment it is not, in order to satisfy a check about client
bundles that never concerned it. The layering fix puts the guard where the risk
actually lives. `client.ts` holds the connection and carries no guard, because
the worker and jobs legitimately need it; `index.ts` re-exports it behind
`server-only` and is what application code imports, so a Client Component
reaching for the database still fails the build. The asymmetry is deliberate: the
file a client component would plausibly import is guarded twice, and the file
only Node touches is guarded by lint plus a test that fails if any npm script
reintroduces the condition flag.

---

## D7 · The boundary rule was passing vacuously, and only writing the test showed it

Asked to turn a manual probe into a permanent test, I wrote fixture components
importing `@/server/db`, linted them, and asserted the rule fired. It reported
zero violations. My first guess was a broken harness — an ignore pattern
swallowing the fixtures — but the real cause was worse: `no-restricted-imports`
was scoped to `components/`, `lib/` and `app/`, so a client component anywhere
else was never checked. The guard I had been describing as "enforced twice" had a
hole, and the original manual probe had missed it purely because I happened to
put that probe file in `components/`. The rule is now deny-by-default across
every file with server paths exempted explicitly, and the suite covers four
bypass paths including `server/db/client.ts`, which has no build-time guard and
therefore rests on lint alone. This is the strongest argument in the repo for the
rule that a guard without a regression test is not a guard: the test's first act
was to falsify the claim it had been written to confirm.

---

## D8 · Two canaries, and why the first one proved nothing

Before trusting a clean secret-scan result I checked the scanner could detect
anything at all, using the AWS key from the official documentation. It reported
no leaks. The obvious reading is that the scanner is broken; the actual reason is
that gitleaks allowlists that exact key by default, because it appears in so much
documentation that flagging it is pure noise. So the canary was
indistinguishable from a working scan finding nothing — the worst outcome
available, because it is silently uninformative in the same direction as success.
A second canary using a realistically-shaped GitHub token was flagged
immediately, and that is what makes "6 commits scanned, no leaks found" over our
history mean something. The same shape of mistake appears twice more in Phase 0
— the boundary rule above and the payload-capture helper — so the rule I now
apply is that any assertion of the form "X is absent" needs a paired positive
control proving the mechanism can see X when it is present.

---

## D9 · Secret scanning runs the gitleaks binary, not the action

**Status:** active · **File:** `.github/workflows/ci.yml`

The first CI run failed on the secret-scan step, and the failure mode mattered
more than the failure. `gitleaks/gitleaks-action@v2` derives a commit range of
`<before>^..<after>` on push; on a first push `<before>` is the root commit, and
`<root>^` is an unknown revision. Git errored, gitleaks aborted having read zero
bytes, and the step logged _"no leaks found in partial scan"_ before exiting
non-zero. Had the action been configured to tolerate that exit code — a common
convenience when a step is noisy — CI would have gone green while scanning
nothing, on the exact run that first pushed this repository to a remote. The
workflow now downloads a pinned binary and runs
`gitleaks git . --log-opts="--all"`, which reads the whole history every time and
is the identical command available locally, so a CI result can be reproduced
without reasoning about the action's range arithmetic.

---

## D10 · `ORDER BY ... DESC NULLS LAST` is load-bearing, not cosmetic

**Status:** active · **File:** `server/services/problems/queries.ts`

The catalog list was doing a sequential scan at 20,000 rows despite an index
that looked exactly right. The cause is a mismatch nobody sees by reading the
code: Drizzle emits index columns as `DESC NULLS LAST`, while a bare
`ORDER BY x DESC` in Postgres means `DESC NULLS FIRST`. Those are different
sort orders, so the planner cannot use the index to satisfy the ordering and
falls back to a full scan plus a top-N sort.

Both columns are `NOT NULL`, so **the results are byte-identical either way** —
which is precisely why no functional test could have caught it. Measured at
20k rows: **27.98 ms sequential scan versus 0.27 ms index scan**, a hundredfold
difference produced by two words.

The fix is to spell `NULLS LAST` in the ORDER BY so it matches the index.
`tests/problems/plans.test.ts` asserts the plan, and carries a **positive
control** that runs the same query without `NULLS LAST` and requires it to seq
scan — so if a future Postgres or Drizzle version makes the two forms
equivalent, the guard fails loudly rather than passing vacuously.

The general lesson, and the reason this is written down: an index that exists,
is named correctly, and is listed in the schema can still be completely unused.
The only way to know is to read the plan.
