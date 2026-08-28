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

---

## D11 · Cloudflare R2 over Supabase Storage, because the fake was better than the vendor

**Status:** active · supersedes the Supabase provider written in F0.5
**Files:** `server/services/storage/s3.ts` (added), `supabase.ts` (deleted)

### The finding

F0.5 shipped with an in-memory `StorageProvider` implementing a faithful
60-second presigned-upload expiry, tested with an injected clock. Review asked
the right question: **is the fake more capable than the real thing?**

It was. From `@supabase/storage-js` source:

```ts
async createSignedUploadUrl(path: string, options?: { upsert: boolean })
// ...
const data = await post(this.fetch, `${this.url}/object/upload/sign/${_path}`, {}, { headers })
```

There is **no expiry parameter**, and the request body is literally `{}`. Upload
URL validity is fixed server-side. The asymmetry is easy to miss because the
_download_ API does take one:

| API                                                    | Expiry            |
| ------------------------------------------------------ | ----------------- |
| `createSignedUrl(path, **expiresIn**, …)` — download   | caller-controlled |
| `createSignedUploadUrl(path, { upsert })` — **upload** | **not exposed**   |

So the F0.5 criterion _"a presigned URL is unusable 90 seconds after issue"_
was **unsatisfiable on Supabase** while passing in CI against a fake that
implemented it perfectly. Green suite, false claim — the same shape as the AWS
canary that "passed" because gitleaks allowlists it, and the gitleaks run that
reported no leaks after reading zero bytes.

### The decision

Switch to **S3-compatible storage (Cloudflare R2)**. SigV4 presigning signs
`X-Amz-Expires` **into** the URL, so expiry is caller-controlled and enforced by
any conformant implementation — it is the protocol, not a vendor promise.
Ranged reads (`GetObject` with `Range`) are likewise protocol-level, so the
magic-byte check reads twelve bytes instead of downloading two megabytes.

The `StorageProvider` seam did its job: the swap touched two files and no
service or route logic. That is what the seam was for.

### How the contract is now verified

`tests/profile/storage-contract.test.ts` runs in two tiers.

**Always** — protocol assertions needing no account. The presigned URL is
inspected directly: `X-Amz-Expires=60` is present, and requesting a different
expiry produces a **different signature**, proving the value is signed in rather
than a decorative query parameter a server may ignore.

**`STORAGE_INTEGRATION=1`** — the live round trip: presign, direct PUT, ranged
magic-byte read (asserting exactly 12 bytes come back from a 512KB object, which
a provider without Range support cannot do), a genuinely expired URL being
rejected, and cross-user prefix rejection. Skipped without credentials so CI
stays green and honest.

### Still unverified

**No live bucket has been exercised.** Creating a Cloudflare or Supabase account
is not something this environment can do. The always-on tier proves the _client_
signs correctly; the live tier proves the _server_ honours it, and it has never
run. `docs/acceptance-status.md` records that rather than implying otherwise.

### Known deployment dependency: R2 public reads

R2 buckets are **not publicly readable by default**, and there is no equivalent
of an S3 website endpoint. Serving avatars to browsers requires one of:

| Option                            | Cost                                                                               |
| --------------------------------- | ---------------------------------------------------------------------------------- |
| `*.r2.dev` managed subdomain      | free, but **rate limited by Cloudflare** and explicitly not for production traffic |
| Custom domain bound to the bucket | needs a zone on Cloudflare; no rate limit                                          |

This is a **deploy-time dependency, not a code change**: the public origin is
already behind `S3_PUBLIC_BASE_URL`, deliberately separate from `S3_ENDPOINT`.
The signing endpoint carries credentials in its URLs and must never be handed to
a browser; the public base is what `publicUrl()` builds from. Switching from
`r2.dev` to a custom domain — or to a CDN in front of either — is an environment
variable, and `tests/profile/storage-contract.test.ts` asserts the two hosts do
not get conflated.

Flagged now rather than discovered at deploy: on the free `r2.dev` subdomain,
avatar loads will be throttled under load, and the symptom will look like broken
images rather than like rate limiting.

### Rejected alternative

Keeping Supabase and enforcing the 60-second window at confirm time — reject a
key whose presign is older than 60s. Rejected because it does not satisfy the
criterion: the upload URL would still ACCEPT a PUT for the vendor's full
validity window. The object would never be adopted and orphan cleanup would
remove it, but "unusable" would be false. A weaker guarantee described in
stronger words is exactly what this project keeps catching.

---

## D12 · STANDING RULE — verify an upstream constraint upstream

**Status:** permanent · applies to every ticket

Before attributing a limitation to a library, service or framework, **verify it
in that thing's source or wire format, and say where you verified it.** A
plausible-sounding constraint is not a constraint.

This is written down because it has now happened five times, and each time the
constraint lived in our own layer or the verification proved nothing:

| #   | The claim                                                     | What was actually true                                                                                                                           | How it was caught                                                        |
| --- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| 1   | "The AWS key canary proves gitleaks works"                    | gitleaks **allowlists** that documented key by default, so the canary was indistinguishable from a broken scanner                                | second canary with a realistic token                                     |
| 2   | "CI's secret scan is green"                                   | the action computed `<root>^..HEAD`, aborted, read **0 bytes**, and logged _"no leaks found in partial scan"_                                    | reading the step log rather than its colour                              |
| 3   | "`@auth/drizzle-adapter` requires `name` and `image` columns" | its TYPE does; its RUNTIME never reads them — `.values(data)` drops unknown keys                                                                 | running the real adapter against a real database with the columns absent |
| 4   | "Supabase Storage cannot do a 60-second presign"              | true, but our code was **posting `{ expiresIn }` into a body the API discards** — configured-looking and inert, green from both directions       | reading `createSignedUploadUrl` in storage-js                            |
| 5   | "Auth.js cannot distinguish an expired link from a used one"  | Auth.js computes `hasInvite` and `expired` and puts both on the thrown error; **our adapter's `DELETE … RETURNING`** was discarding the evidence | reading `lib/actions/callback/index.js`                                  |

The shape is constant: **a limitation attributed upstream that lives in our own
layer, or a green result that verified nothing.** Both feel like findings. Both
end the investigation early, which is exactly what makes them dangerous.

### The rule, operationally

1. **Read the upstream.** `node_modules` is on disk. The signature, the request
   body, the branch that throws — look at it. Cite the file in a comment.
2. **Name the layer.** State whether the constraint is in the vendor, the
   protocol, or our code. If it is ours, it is a bug, not a constraint.
3. **A parameter that might be ignored is not proof.** Presence of
   `X-Amz-Expires` proves nothing; a **different signature for a different
   value** proves it is signed in. Prefer an assertion that would fail if the
   parameter were decorative.
4. **Any "X is absent" result needs a positive control** proving the mechanism
   can see X when X is present.

Instances 3–5 were each found one review round late. The cost of following this
rule is minutes; the cost of skipping it has been a wrong architecture decision
(4), a hundred lines of unnecessary adapter (3), and a user-facing error page
that would have said the wrong thing (5).

---

## D13 · Magic links expire in 15 minutes, overriding Auth.js's 24 hours

**Status:** active · **File:** `server/services/auth/config.ts`

`@auth/core/providers/resend.js` sets `maxAge: 24 * 60 * 60` — **verified in
source**, per D12. We override it to **15 minutes**.

A magic link is a **bearer credential sitting in an inbox**. Anyone holding the
link is the account. Twenty-four hours is a long exposure for something that
gets forwarded, synced to a shared or family device, indexed by a desktop search
tool, or left in a mailbox that is compromised later that day. Fifteen minutes
is comfortably enough to click a link you just asked for, and it bounds the
window in which a leaked email body is worth anything.

### The consequence, accepted deliberately

At fifteen minutes **the expired state will genuinely happen** — people open
email late. That is why `/login/verify` distinguishes expired from used from
invalid (D12 #5) and offers a resend from the expired page rather than a dead
end.

That resend is the same server action `/login` uses, and therefore the same
server-side cooldown. **A resend button on the expired page that skipped the
cooldown would be a bypass of it** — the cooldown has to live on the server for
exactly this reason: a per-component countdown resets on reload, so it is UX,
never the control.

---

## D14 · `aria-disabled` for waiting states, `disabled` only for transient ones

**Decision.** A control that is unavailable for a _duration the user is waiting
out_ — a resend cooldown, a rate-limit window — uses `aria-disabled` and guards
its own handler. A control that is unavailable _transiently while an action is
in flight_ keeps the real `disabled` attribute.

**Why.** `disabled` removes an element from the tab order entirely. A keyboard
user who tabs to the resend button, finds it gone, and has no way to discover
that it will return in 45 seconds is worse off than one who reaches it and hears
"Resend in 45s". For a ~1s in-flight state the opposite is true: removing it
prevents a double submit and nobody is navigating during it.

**How it was found.** Not by review — by `e2e/keyboard.spec.ts` failing to reach
the control at all. The traversal recorded `[{skip link}, {Use a different
address}]` with the resend button simply absent. Three prior passes over this
UI, including one specifically about the cooldown, did not notice.

**The safety argument does not rest on the attribute.** `aria-disabled` is
advisory — a determined client can press the button. That is fine here because
the cooldown is enforced by the server action in `app/(auth)/login/actions.ts`,
which both entry points call. A press inside the window is _answered_ with the
remaining wait, not obeyed. Had the attribute been the enforcement, this would
have been the wrong trade.

**Rejected:** keeping `disabled` and adding an adjacent `aria-live` region
announcing the countdown. It fixes announcement but not reachability, and it
narrates a timer to a screen-reader user once per second.

**Verified, not assumed.** Per D12, the Tailwind variant was checked in the
built stylesheet rather than trusted to exist:

```
aria-disabled\:opacity-60[aria-disabled=true],.disabled\:opacity-60:disabled{opacity:.6}
```

A variant that silently compiled to nothing would have left the control looking
enabled throughout its cooldown — configured-looking, inert, green from both
directions.

---

## D15 · Middleware forwards the pathname; the layout re-validates it

**Decision.** `middleware.ts` sets a request-only header
(`x-traceloop-pathname`) on authenticated requests, and `app/(app)/layout.tsx`
reads it to build the `returnTo` it hands to `/onboarding`.

**Why it was needed.** The onboarding gate called `redirect('/onboarding')` with
no destination, so a first-time user following a magic link to `/problems`
finished onboarding on `/dashboard`. `/onboarding` already honoured `returnTo`;
the gate simply had nothing to give it, because **a Next App Router layout is
not passed the pathname** — only pages receive `params`/`searchParams`.

**Rejected alternatives.** Doing the completeness check in middleware: it runs
on the edge with no database connection, so it would need either a JWT claim
(unrevokable when a profile changes) or a network hop per request — the same
reasoning that keeps the role check out of middleware. Passing the path as a
search param on the redirect: it is already lost by the time the layout runs.

**The header is ours and is still not trusted.** The layout runs it through
`validateReturnTo` like any other candidate. It is set on the inbound request
via `NextResponse.next({ request: { headers } })`, so it never reaches the
browser — but "we set it" is not a reason to skip validation, and if it ever
becomes settable from outside, the allowlist is what holds.

Pinned by _"the gate defers the destination rather than discarding it"_ in
`e2e/auth-flow.spec.ts`, which fails if the `returnTo` is dropped again.

---

## D16 · STANDING RULE — an `ON CONFLICT` clause names the constraint it means

**Decision.** Every `onConflictDoNothing` / `onConflictDoUpdate` specifies a
`target`. A bare clause is only acceptable on a table with exactly one unique
constraint, and even then the target is written out.

**The bug that produced this rule.** F1.2's importer failed to import a URL it
had every right to accept, and it took two mistakes stacked on each other:

1. The slug for an imported problem was a **deterministic hash of the normalised
   URL**. That looked tidy and quietly asserted "one URL, one row, forever".
2. The partial unique index on `external_url_normalised` is scoped
   `WHERE status <> 'archived'`, which **deliberately permits two rows to share
   a URL** — one archived, one live — so a user who archived a problem can add
   it back.

Together: the second insert produced the same slug as the archived row and
collided on `problems_slug_key`. And because the conflict clause was a bare
`onConflictDoNothing()`, which covers **every unique constraint on the table**,
that collision was absorbed exactly like a dedup race. The insert returned no
row; the fallback lookup — scoped to non-archived rows, correctly — found
nothing; and the service threw on a row that should have been created.

**Why the bare clause is the load-bearing mistake.** The deterministic slug was
wrong, but on its own it produces a _unique violation_, which is loud, points at
`problems_slug_key`, and takes a minute to diagnose. The untargeted clause is
what converted a named constraint violation into a silent nothing, and made the
symptom appear one layer away from the cause. **An untargeted `ON CONFLICT` does
not suppress an error; it suppresses the distinction between errors.**

**The general shape.** `ON CONFLICT DO NOTHING` with no target means "any unique
constraint". Almost every real use means one specific constraint and treats it
as recoverable — a lost race, an idempotent re-insert. Every _other_ unique
constraint on that table is a genuine bug, and the bare form silently reclassifies
all of them as the expected case.

### The audit

Asked whether this pattern existed elsewhere. Every `onConflictDo*` in the tree
was checked against the live schema's unique-index count (`pg_index`, rather
than by reading the Drizzle definitions — the database is the authority on what
can actually conflict):

| Table           | Unique constraints                                              | Verdict                             |
| --------------- | --------------------------------------------------------------- | ----------------------------------- |
| `problems`      | **3** — pkey, `slug_key`, partial `external_url_normalised_key` | the bug above; now targeted         |
| `user_problems` | **2** — pkey, `user_problem_key`                                | **latent instance, fixed**          |
| `problem_tags`  | 1 — composite PK                                                | unambiguous; 4 call sites left bare |
| `user_profiles` | 1 — pkey                                                        | unambiguous                         |

The `user_problems` case is the one worth noting: `linkUserProblem`'s insert
returns a row or not, and **that return value is the only thing distinguishing
`duplicate` from `created`/`linked`** in the import counts. A primary-key
collision on a random UUID is not a realistic worry, but the clause was one
schema change away from mattering, and it is the same defect written by the same
hands in the same week as the one above. Targeted.

The four `problem_tags` sites are correct as written — a table with a single
composite primary key has nothing to disambiguate. They are left bare rather
than churned, and this entry is the reason a future reader will not "fix" them.

**Consequence for partial indexes.** Targeting a partial unique index requires
the index predicate as well as the columns, or Postgres cannot match the
inference and rejects the statement:

```ts
.onConflictDoNothing({
  target: problems.externalUrlNormalised,
  where: sql`... is not null and ${problems.status} <> 'archived'`,
})
```

Drizzle spells this `where` on `onConflictDoNothing` and `targetWhere` on
`onConflictDoUpdate`. Verified against the emitted SQL, not assumed — per D12.

**Rejected:** a lint rule banning the bare form. It would fire on the four
correct `problem_tags` sites, and a rule with a 4-to-1 false-positive rate
teaches people to disable it. The check belongs in review, and now in this entry.

---

## D17 · F2.3 is cut, so the in-process runner is permanent

**Decision (Vikram, scope).** The target build is 11 more tickets, not 21. F2.3
`job-runtime` — BullMQ, Upstash Redis, the standalone queue worker — is cut.

This entry exists because the cut is not only a scheduling change. Roughly
thirty comments across the codebase said "F2.3 replaces this", and every one of
them was a promise that is no longer going to be kept. They were rewritten
rather than left, because a comment describing a future that will not arrive is
worse than no comment: it tells the next reader the limitation is temporary.

### What the seam still buys

The `JobRunner` seam was justified as "so F2.3 can swap the executor". That
justification is gone and the design survives it — for a better reason than the
original one.

Job state and payload live in `import_jobs`. With a queue, that was tidiness:
the queue could have carried the CSV. **Without a queue, the database is the
only thing that can recover a job at all.** A runner holding parsed rows in
memory loses the import outright when its process ends, and nothing re-delivers
it. So the property that made the seam honest — `enqueue(jobId)` and nothing
else — is now the property that makes recovery possible.

### What is permanently missing, stated plainly

| Gap                                  | Consequence                                          | Mitigation                                                                                                       |
| ------------------------------------ | ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| No automatic retry                   | A job whose process dies is dead until a person acts | Re-uploading the same file re-enqueues it; content hash identifies it, the watermark makes the repeat idempotent |
| No scheduled sweep                   | `sweepStalledJobs` runs only when called             | Called from the request path. A job can sit `running` until someone loads the page                               |
| No scheduled avatar cleanup          | Orphaned uploads accumulate                          | `npm run avatars:cleanup`, on demand or from a host cron                                                         |
| No queue-backed retries with backoff | A transient failure is a failed job                  | The user retries by re-uploading                                                                                 |

**Cut scope has two surfaces, not one.** The obvious one is code that references
the cut thing. The one that got missed is **user-facing copy promising the same
future**: `/settings/import` already told users "re-upload the same file to
continue from where it left off", and `startImport` already returned without
re-enqueueing. Each was validating the other — the copy read as a description of
the code, the code read as an implementation of the copy — and neither moved
when the assumption underneath both disappeared. When something is cut, grep the
strings a user reads, not only the comments a developer reads.

**A tested function nothing can invoke looks handled.** `cleanupOrphanedAvatars`
had tests, coverage, and a comment saying F2.3 would schedule it. With F2.3 cut
it was unreachable code that passed every check we have — review sees a tested
function, coverage sees exercised lines, and the acceptance record sees a
criterion met. Nothing in the toolchain reports "this is never called in
production". That is why it now has `npm run avatars:cleanup`: not because a
manual script is good, but because an invocable-but-manual path is honest and an
uninvocable one is a lie that passes review.

**A found bug, from making this explicit.** `startImport` returned an existing
job without re-enqueueing it, which was defensible only while F2.3 was going to
add queue-level retries — and `/settings/import` already told the user
"re-upload the same file to continue from where it left off". That promise was
false. It now re-enqueues a job in `stalled`, `failed` or `pending`, and
deliberately does not touch one that is genuinely `running` (that would double
the work rather than resume it). The cut turned a deferred gap into a live bug,
which is exactly the kind of thing a scope change hides.

### The consequence for F3.1, flagged before reaching it

**F3.1 `execution-pipeline` is specified as "Monaco Editor & Queued Judge0
Execution".** It is in the target scope and its queue is not.

Judge0 is submit-then-poll: a submission returns a token and the result arrives
later. That is queue-shaped work, and the honest options are:

1. **Reuse this pattern.** An `execution_jobs` table, the same `JobRunner` seam,
   the same polling contract, the same in-process runner. It generalises
   cleanly — this ticket already proved the shape — and inherits exactly the
   gaps in the table above: an execution whose process dies needs the user to
   re-run it.
2. **Synchronous submit-and-wait** inside the request. Simpler, and wrong for
   anything but the fastest submissions; a serverless timeout would strand
   executions with no record.

**Option 1 is APPROVED** (Vikram, 2026-08-15), for two reasons worth recording:
the shape already exists and its gaps are documented, and synchronous
submit-and-wait strands executions on a serverless timeout with no record — the
failure mode hardest to diagnose. One consistent pattern with known limits beats
two patterns.

**Consequence for F3.1's acceptance record.** Its "queued state machine"
criterion will be met by the in-process runner, not BullMQ. That must be written
into the acceptance status as what was ACTUALLY built, with the same gaps this
entry lists — no automatic retry, no scheduled sweep, user-driven recovery.
Recording it as "queued execution: DONE" would be true of the words and false
about the system.

### Also cut, and their live consequences

F2.4 `notification-engine` and F2.5 `contest-upsolve` are cut, so no scheduled
reminders and no contest sync — both were queue-dependent. F4.3 `rewards-trust`
is cut, which means **C8** (daily cap + cooldown + minimum active time on every
reward-granting path) has no path to guard: the constraint stands, and nothing
in the target scope grants rewards. F1.2's curated library is cut to a small
verified subset with the rest BLOCKED on a real list.

---

## D18 · Streak: history is immutable, freeze balance is derived

Two decisions F1.3's spec explicitly refuses to leave accidental. Both are
invisible until they are wrong, which is why they are here before the code.

### A recorded day never moves

`daily_sessions.local_date` is resolved in the user's timezone **at activity
time** and is never re-resolved. Changing timezone affects future activity only.

**Rejected:** recomputing history in the new zone. It makes the whole record
internally consistent with where the user is now, and the price is that solves
migrate between days — silently breaking a streak someone earned, or inventing
one they did not. It also makes recompute non-deterministic with respect to a
mutable user field, so the same input produces different output depending on a
setting changed months later.

**The cost is bigger than "the days are further apart", and the settings page
has to say so.** Moving IST → America/New_York (−9:30) can produce:

- the **same local date twice** — a solve at 09:00 IST on the 2nd and another at
  20:00 EST on the 1st both land on dates the user has already "had"
- an **apparent skipped day** despite solving every calendar day they experienced

Either reads as a broken streak rather than a policy, and a user who cannot tell
those apart will report it as a bug. So `/settings/goals` states it in one line
when the timezone changes — _past days stay as recorded; only future days use
the new zone_ — and a test asserts that copy exists. Copy is the mitigation
here, not a nicety; the behaviour is correct and unexplained behaviour is
indistinguishable from a defect. (D17 already records the reverse of this: when
scope changed, the stale thing that mattered most was user-facing copy.)

### The freeze balance is computed, never stored

`balance = 2 − (freezes consumed in the current local month)`.

**Rejected:** a stored counter refilled monthly. A stored counter needs
something to refill it, and **F2.3 is cut — no job is coming** (D17). A counter
with no refiller is a number that silently stops being true. Deriving it makes
the refill a property of the query: nothing to schedule, nothing to drift, and
the month boundary is evaluated in the user's own timezone like every other day
boundary in this module.

The consumption log remains the source of truth and records the date each freeze
covered, which is what the acceptance criterion asks to see.

### Two test decisions worth recording

**Node and Postgres must agree on the same instant.** The engine resolves days
with `Intl.DateTimeFormat`; the database also has `AT TIME ZONE`, and the two
can be compiled against **different tzdata versions**. If they ever disagreed,
every stored `local_date` would be quietly wrong while both layers reported
green — an assumption that differs across two layers with no test spanning them.
A cross-check test spans them.

**DST fall-back has an ambiguous hour.** 01:30 in America/New_York happens twice
on the fall-back date. `Intl` resolves one of them, and in practice both
occurrences carry the same local _date_, so day attribution is safe either way —
but that safety is a property of the calendar, not of anything we wrote. It is
asserted explicitly rather than left as an assumption inside a passing test.

### D18 addenda — found while building

**`today` is a parameter, never a clock read.** `computeStreak` and
`recomputeStreak` take the local date rather than calling `new Date()`
internally. A streak service that reads the clock cannot be tested across a DST
boundary, a leap day or a year rollover without changing the machine's clock —
which is to say it cannot be tested across exactly the boundaries that break
streak engines. Every DST and leap-day test in `tests/streak/` exists because
this is a parameter.

**A freeze must not be spent on today.** Coverage is decided over days strictly
before today. Today is not a missed day — the user has the rest of it — so
offering it to the freeze logic burns one on every recompute, drains the monthly
allowance in two days, and hands out protection nobody asked for. The symptom
was a five-day run reading as six.

**The heatmap distinguishes frozen from solved.** Both count toward the streak;
only one is something the user did. Rendering them identically shows an unbroken
wall of green across days with no activity, and the user believes it — worse
than the confusion D18 describes for the timezone change, because they are not
confused, they are confidently wrong about their own history. Frozen cells get a
distinct hue **and** a diagonal hatch, so the distinction survives greyscale,
colourblindness and a screenshot; colour alone fails all three.

**A test asserted a bug that was not there.** "Yesterday being incomplete breaks
the streak" used two settled misses and expected a break — but two is exactly
the monthly freeze allowance, so the chain correctly survived at 7. Every
previous finding in this project has been the code being wrong; this is the
first where the expectation was wrong and the code was right, and had the
implementation happened to match the bad expectation, correct behaviour would
have been "fixed". The correction asserts `longestStreak === 7` so the freezes
are visible in the result: a test that cannot distinguish 5-solved-plus-2-frozen
from 7-solved is not testing what its name says.

---

## D19 · The shell recomputes the streak on read

The streak badge and the goal ring sit on every authenticated page. F0.4 built
both as pure props and left the layout passing `streakDays: 0`, with a standing
note that F1.3 would supply the real values. It does, through one call —
`summariseForShell` — so the components still never query.

**The call recomputes rather than reading `user_streaks` as stored.**

**Rejected:** trusting the stored row. It is one indexed read instead of four,
and it is wrong at exactly the moment that matters. The stored number ages
overnight with nothing to age it — a user who missed yesterday still carries
last night's count, and whether a freeze covers that missed day is decided _by_
the recompute, not by whoever reads the row afterwards. The badge would show a
streak that has already broken, on the most-visited surface in the product,
until something unrelated happened to rebuild it. F2.3 is cut, so "something
unrelated" is not a scheduled job (D17); it is the user opening
`/settings/goals`.

The cost is bounded and stated rather than assumed: at most a year of narrow
rows over `daily_sessions_user_date_idx`, and `recomputeStreak` compares before
it writes, so an unchanged state performs **no writes at all**. A test asserts
that directly — two calls in a row return the same value and leave the full
`user_streaks` row byte-identical, `updated_at` included — because "safe to call
on every page load" is a claim about writes, not about the return value.

### The ring shows solves; `goalMet` says whether the day counted

A day also completes at one solve alongside two revisions. So `goalCompleted`
can sit below `goalTarget` on a day that is genuinely done, and the two obvious
fixes are both bad: rounding the count up to the target lies about what the user
did, and showing `1 of 2` alone contradicts the badge beside it, which has
already counted the day.

`ShellStreak` therefore carries both facts. The count stays honest and `goalMet`
fills the arc. The component takes it as a prop and infers nothing — the rule
stays in `evaluateDayCompletion`, which is the one place allowed to decide what
a complete day is.

**`atRisk` requires a streak to lose.** It is `currentStreak > 0 && !completed`,
not `!completed`. The flag turns the badge warning-coloured, and on a zero
streak that is an alarm about nothing — which is how a colour teaches people to
stop reading it.

### Three copies of "which target applied" became one

`targetOn` and `DEFAULT_TARGET_PROBLEMS` now live in
`server/services/streak/goals.ts`. The recompute, the heatmap and the shell each
had their own copy of the effective-date walk and their own literal `2`. Nothing
would have failed if one of them drifted; the symptom would have been the
heatmap disagreeing with the streak drawn directly above it, which is precisely
what `rules.ts` refuses to allow for the completion rule itself.

---

## D20 · The session record is its events, not a duration column

F1.4's schema has no `active_duration_seconds`. The number is computed from
`session_events` on every read.

**Rejected:** a counter on the session, incremented as pause intervals close.
One query instead of two, and wrong in a way nothing detects. A counter
incremented twice is silently and permanently off; the events version answers
the same for a duplicated `paused`, because a pause while already paused opens
no new interval. That idempotence is the property a counter cannot have, and it
is what makes the value safe to recompute rather than repair.

It also removes the field a hostile client would aim at. There is nowhere in the
schema to put a duration, so there is nothing to defend.

### Two local dates, and the streak credits the later one

A session begun 23:50 and solved 00:30 spans a day boundary. `started_local_date`
and `ended_local_date` are each resolved in the user's timezone at the moment
they are written and never re-resolved — D18's rule applied to sessions.

The streak credits `ended_local_date`: the day the solve became a fact.

**Rejected:** crediting the day the sitting began. It reads more naturally
("I started this last night") and it hands out a way to game the streak — hold a
session open across midnight and bank a solve for a day you did not finish. The
version that cannot be gamed wins, and the cost is a session that occasionally
counts for the day after the one it felt like.

### The six-hour rule holds without anything scheduling it

The ticket asks for "a background job" to auto-close abandoned sessions. F2.3 is
cut (D17), so there is none. Instead:

- the shell's own read closes the CURRENT user's stale session — free, because
  it had already loaded that session to draw the timer
- `npm run sessions:sweep` closes everyone else's, on demand

**What that costs:** a session belonging to someone who never returns stays live
until a human runs the script. It blocks nothing — the owner's next page load
sweeps it first — and distorts nothing except a count of live sessions. That is
a smaller cost than F1.2's dead import jobs, and it is the same shape: recovery
is user-driven, not scheduled.

**Both the autopause and the abandonment are stamped `last_heartbeat_at`**, not
the moment the server noticed. A user who closed their laptop stopped working
when their heartbeats stopped; stamping discovery time would have credited 86
minutes of work to someone who had walked away, which a test asserts directly.

### Abandonment is not an attempt

`user_problems` is untouched when a session is abandoned, by the user or by the
sweep. An attempt is something the user finished making a claim about — solved,
or explicitly stuck. Counting abandonment would inflate `total_attempts` for
everyone who ever closed a tab, and the sweep does it on their behalf, so the
inflation would be automatic and invisible.

The same instinct, from the other side: a later `stuck` sitting never un-solves a
problem. Solving it is a fact about the past.

### The client cannot forge a time because there is no field for one

The adversarial requirement is met by the SHAPE of the contract rather than by a
branch that ignores suspicious input. No schema in `server/services/session/input.ts`
mentions a duration, an elapsed count or a timestamp, so Zod drops a forged one
before any handler runs, and `now` is resolved inside the adapter.

That distinction matters for the future: a defensive branch can be deleted by
someone who believes it is dead code, whereas adding a `durationSeconds` field to
a schema is an obvious and reviewable change.

---

## D21 · The taxonomy is declared once, and JSONB holds nothing anyone will query

F1.5's storage rule is the ticket, and both halves of it are decisions with a
cost.

### One array, three consumers

`lib/reflection/taxonomy.ts` declares the categories. `pgEnum` is built from it
and the form's labels come from it, so the Postgres enum, the Zod schema and the
checkboxes cannot disagree.

**Rejected:** writing the list where each consumer needs it. It reads more
directly at every single site and drifts at exactly one — and the symptom is a
category the form offers, the user picks, and the database rejects on submit,
after they have typed a paragraph. A test asserts
`enum_range(NULL::mistake_category)` equals the array, so the generation is
proved rather than assumed.

It lives in `lib/` because `components/` may not import from `server/` (F0.1) —
the same reason `lib/streak/heatmap-day.ts` and `lib/session/timer-bar-state.ts`
do.

### The rule for `extras`

**If anything will ever filter, group or sort by it, it is a column.** Nothing
else may go in the JSONB.

That is why `extras` is empty in practice today: everything F1.6, F2.1 and F3.5
read — mistake category, stuck category, confidence, source — is a column or a
child row. `extras` exists so a future question can be captured without a
migration, not as a place to put a taxonomy.

Two tests hold the line. One runs the criterion's own sentence as SQL
(`WHERE category = 'off_by_one'`), which is a query that could not be written if
the values lived in JSON. The other reads `information_schema` and asserts
`reflections.extras` is the only jsonb column across all four tables, so
someone moving a category in there later to avoid a migration fails immediately
rather than in F3.5, when a `GROUP BY` quietly becomes a full scan.

CHECK constraints also cap every free-text field. Prose growing into the place
structured data should have gone is the exact failure the ticket names, and the
cap is in the database because a service-side limit is bypassed by every other
write path.

### A skipped question is not an answer

No reflection row means the user skipped it. `mistakes: ['none']` means they
said nothing went wrong. **These are different facts and nothing may merge
them** — F3.5 counts recurrence, so conflating them turns every skipped question
into evidence of a clean solve.

The form says so in words, next to the field, for the same reason D18's timezone
copy exists: behaviour that is correct and unexplained is indistinguishable from
a defect.

### Confidence keeps one home

`solve_sessions.confidence` (F1.4), mirrored to `user_problems` for the catalog.
The reflection writes both in one transaction rather than adding a
`reflections.confidence`, because two columns holding one fact disagree the
first time a write path forgets the other.

### Abandoned sessions cannot be reflected on

Same reason they are not attempts (D20): the sweep abandons sessions on the
user's behalf, so a reflection attached to one would be a considered account of
a solve that never concluded. An abandoned sitting still appears in the attempt
timeline — it happened — but carries no attempt number, so the timeline and
`user_problems.total_attempts` cannot disagree.

### Postgres cannot remove an enum value

Adding `stuck_marked` to `session_event_type` uses `ADD VALUE IF NOT EXISTS`,
hand-added to the generated migration. There is no `ALTER TYPE ... DROP VALUE`,
so a down migration cannot undo it, and without the clause a single-step
rollback followed by a re-apply fails on "label already exists". The down
migration records this, including that `db:generate` will not re-emit the clause
if the file is ever regenerated.
