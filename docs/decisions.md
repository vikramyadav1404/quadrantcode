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
(`x-quadrantcode-pathname`) on authenticated requests, and `app/(app)/layout.tsx`
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

> **Historical decision, superseded for code execution by D26.** BullMQ, Redis
> and the generic standalone worker remain cut. The managed Queue exception is
> intentionally limited to untrusted execution; imports retain this decision.

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

---

## D22 · The dashboard is precomputed, and says so

F1.6's performance rule is that heavy aggregates are rolled up rather than
computed on a page load. Three decisions follow from taking that seriously.

### Three rollup tables, not one

A session belongs to a problem, a problem carries zero or more topic tags, and a
stuck marker carries a category. Those are three different grains, and one table
cannot hold them without lying about at least one:

- summing a per-topic table to get a headline total **double-counts** a problem
  tagged both `graphs` and `bfs`
- and **loses entirely** a problem with no tags

**Rejected:** one wide table with a nullable `topic` column and a grand-total
row. It is one table instead of three, and it makes every read filter on
`topic IS NULL` to avoid counting the same session twice — a condition that is
easy to forget in exactly the query where forgetting it doubles a number.

Sums are stored, never ratios or averages: an average of averages is not an
average, and a ratio cannot be added across days. `confidence_sum` and
`confidence_count` travel together, and the division happens once, at the end,
over whatever range the page is showing.

### Delete-and-rewrite, not upsert

A day's rows are deleted and rewritten inside one transaction. That makes the
acceptance criterion — "two runs for one day produce one row set" — true by
construction rather than by care, and it is the only version that stays correct
when a session is deleted or a topic tag is removed. An upsert leaves the old
row behind, and the dashboard keeps reporting activity that no longer exists.

Readers are unaffected: Postgres keeps the previous rows visible until the
transaction commits, so a page loading mid-rollup sees the old numbers rather
than none.

**`computed_at` comes from the database clock, not from the `now` parameter.**
It is compared against `solve_sessions.updated_at`, which Postgres writes.
Comparing two clocks is how every day ends up permanently stale — which is
precisely what three freshness tests reported before the column default took
over. `now` is still a parameter, and still used for the arithmetic (D18); it is
just not the thing being compared against a timestamp the database wrote.

### Inline SVG instead of Recharts

CLAUDE.md's stack names Recharts, and F1.6 is the first ticket that would use it.
It is not installed, and this ticket needs two charts: a three-segment difficulty
split and twelve trend bars.

**Deviating, with the reason recorded rather than taken silently.** A charting
library means a client-side dependency and client components on a page whose
entire purpose is to be cheap — `/analytics` currently ships **163 B** of route
JS because every part of it renders on the server. Adding ~100kb of runtime to
draw fifteen rectangles inverts the thing the ticket is asking for.

This is not a rule against Recharts. When a ticket needs interactive charts —
tooltips, zoom, live series — the dependency earns its place and should be added
then. Fifteen rectangles do not earn it.

### The wording rule is guarded at two layers

The ticket forbids calling the score AI or a prediction anywhere, and C4 forbids
the product over-claiming certainty generally. A weak-topic panel is where that
temptation lives, because the honest phrasing is longer than the dishonest one.

`tests/analytics/wording.test.ts` greps the service, components, page and
`docs/scoring.md`. `e2e/analytics.spec.ts` reads the **rendered** page, because a
component could assemble a banned phrase from fragments the source grep would
never match. Both carry positive controls — a guard that scans nothing passes
every "this word is absent" assertion, which is the same failure shape as the
0-byte gitleaks run (D4).

---

## D23 · The revision engine, and the page the cut ticket left behind

### The simulation is the deliverable, not the ladder

F2.1's most valuable output is not the scheduling code — it is
`tests/revision/simulation.test.ts`, because a ladder cannot be checked by
reading it. Every rung looks reasonable alone; whether the intervals a growing
library generates stay inside one person's day is emergent.

**It found something on the first run.** The assertion that overdue work "does
not accumulate unboundedly" failed: mean queue depth climbed from 3.8 in the
middle thirty days to 5.9 in the last thirty. Chasing it produced the finding
that matters — the due count climbs because the LIBRARY climbs. Twice as many
problems generate twice as many revisions; that is arithmetic about the user.

A scheduler falling behind looks different: work that came due and was never
reached. The assertion now counts **arrears** — items waiting more than a week —
and they stay at zero.

**The boundary is asserted, not assumed.** At one new problem a day, five
revisions a day cannot drain the arrivals: arrears appear and depth passes 20.
The default cap is therefore a statement about how many problems a user can take
on, and that sentence is backed by a test rather than by reasoning.

### Confidence picks the ladder; everything else picks the rung

**Rejected:** treating low confidence as one more compression step. It reads as
consistent — every signal moves one rung — and it is wrong about what the signal
means. Low confidence is a statement about the whole solve, not about the next
interval, so it should shorten every gap that follows rather than one.

The two ladders are the same LENGTH so that a rung means the same thing on both,
which keeps `ladder_index` comparable across problems and spares the outcome
rules a special case.

**Signals move a step rather than scaling the interval.** Multiplying produces
intervals that are not on the ladder — 4.5 days, 21 on the standard ladder — and
then "which rung are you on" stops meaning anything, which is the language the
outcome rules are written in.

### The floor is enforced three times

Clamped index, floored interval, and a CHECK constraint on the column. The
middle one is redundant while rung 0 is one day, and it stays because the spec's
rule is about the INTERVAL: a future ladder starting elsewhere must not be able
to break it quietly.

### Scheduling happens inside the completion transaction

Not afterwards, and not in the action. A completed solve whose revision was
never scheduled is a problem that silently never comes back — and unlike the
streak recompute (D19), nothing downstream would notice and repair it.

Re-solving continues from the current rung rather than resetting, so revisiting
a problem held for months is not punished for the revisit.

### `/revision` exists although the ticket puts UI out of scope

F2.1's OUT OF SCOPE names F2.2 for the revision UI. **F2.2 is cut**, and the
sidebar has always linked to `/revision`.

Following the letter would have shipped an engine nothing calls and a navigation
item that 404s — the "dead code that looks handled" this project has refused
twice before. So the smallest honest surface exists: the due list, in risk
order, with the three outcomes. F2.2's four revision MODES stay cut and nothing
here pretends otherwise.

**The page deliberately does not revalidate after recording an outcome.** Doing
so re-renders the queue without the row just answered, erasing the confirmation
the click produced — the user sees their answer flash and vanish, and never
learns when the problem comes back. Found by an e2e test that passed alone and
failed in a full run, which is what that race looks like from outside.

---

## D24 · Execution is a table, a lock, and a provider seam — and never a sandbox

> **Historical implementation, superseded by D26.** Its provider boundary,
> polling shape and “outage is not a verdict” rule remain; dispatch, retry and
> isolation are now implemented by Vercel Queue, Neon leases and Vercel Sandbox.

**Context:** F3.1 specifies Monaco plus BullMQ-queued Judge0 execution. Two
things are missing at once: F2.3 is cut (**D17**) so there is no queue, and
there is no `JUDGE0_URL` so there is no judge.

### The word "sandbox" does not appear, deliberately

The ticket says it outright, and it is worth writing down why the rule is
correct rather than merely obeyed.

`EXECUTION_LIMITS` — 2 s CPU, 5 s wall, 256 MB, no network, 32 KB of captured
output — is **what is submitted with each request**. Whether any of it is
enforced depends on how the Judge0 instance was deployed: its Docker isolation,
its cgroup limits, its network policy. None of that is in this repository.

Calling it a sandbox would claim a property this project cannot observe, and the
person misled is whoever later decides it is safe to run untrusted code. So the
README, the UI and the code all say what is sent, never what is guaranteed.

### The provider seam is what makes BLOCKED honest instead of vague

`ExecutionProvider` has three implementations' worth of intent behind it: the
real one, the fake, and the `executes: boolean` flag that lets any caller ask
whether a result came from running code. `resolveProvider` returns the fake when
there is no URL — so the feature works end to end, and nothing anywhere claims
the results are real.

`Judge0Provider` is written and **UNVERIFIED**, with that word in its header
rather than only in the acceptance record. Supplying a URL is then a
configuration change, not a development task — and the one part that can be
checked without an instance is checked: the status-id mapping is pure and
tested, including that an unknown id becomes `internal_error` rather than
silently becoming `accepted` after a Judge0 upgrade.

**Rejected:** stubbing the calls out with `throw new Error('not implemented')`.
It makes the same BLOCKED honest but leaves nothing to review, and the mapping —
the part most likely to be wrong and cheapest to get right — would not exist.

### The cap is a lock, because the criterion is about parallelism

Counting live rows and then inserting is not atomic. The criterion says the cap
must hold _under a parallel-submit test_, which is precisely the case
check-then-insert fails: six concurrent submissions each read four and each
decide they are the fifth.

`pg_advisory_xact_lock(hashtext(user_id))` inside the submit transaction
serialises only a user racing themselves. Two users can collide on the hash; the
cost is that one waits microseconds, which is not worth a wider key to avoid.

The runner is enqueued **after** the transaction commits — a runner that starts
first reads a row that is not there yet.

**Rejected:** a unique partial index on "live jobs per user". Postgres has no
count constraint; enforcing five would need five nullable slot columns or a
trigger counting rows, both of which are heavier and less obvious than a lock
held for two statements.

### A failed job writes no result

The distinction the whole ticket turns on. `execution_jobs.error` says why the
job failed; `run_attempts` exists only for jobs that actually ran. Writing
`internal_error` on an outage would put a claim about the user's program into
the database that nothing observed — and it would then feed F3.5's mistake
memory as if the user had made a mistake.

Nothing retries, and the message says so. D17's cost, stated rather than
implied.

### Output is rendered, never sanitised

Program output reaches the screen through `{value}` and nothing else. It is not
filtered: `<script>` arrives intact and inert, because a program that prints a
tag should see the tag it printed. A scratchpad that quietly rewrites your
output is worse than one that shows it, and a sanitiser is one more thing that
can have a bug.

The claim is settled in Chromium — with a positive control that sets the same
flag deliberately on the same page first, so a CSP could not make the test pass
by making the payload impossible.

### `expected_output` is unconditionally null, not a branch

C1 means no external platform's tests are ever held, so an external-link problem
can never have expected output. Original problems could — and arrive with F4.1,
which is cut, so the catalog contains none.

A conditional there would be a branch nothing can take, hiding that comparison
is impossible behind code that looks like it handles both cases. Test counts are
`null` rather than `0 / 0`, which reads as a failure rather than as "there was
nothing to check".

### Drafts are local; the server snapshot waits for F3.2

The ticket asks for localStorage autosave **and** a 60-second server snapshot.
localStorage is done, per problem and per language. The server half is deferred
to F3.2, which owns code snapshots.

Building a `code_drafts` table here would create a second home for the user's
code alongside the one F3.2 is specified to build — two stores of the same thing
is a drift with a date on it. Recorded as DEFERRED rather than done twice.

---

## D25 · The log is append-only with one declared exception, and elapsed is derived

**Context:** F3.2 turns `session_events` into the full solve log. Its spec asks
for an `elapsed_ms` column and for the table to reject UPDATE and DELETE, and it
also asks for "delete my solve history" to leave no rows behind.

### `elapsed_ms` is not a column

**D20 already made this decision one level up.** F1.4 removed
`solve_sessions.active_duration_seconds` on the grounds that events are the
record. Storing elapsed on every event is that same column again — one row down,
multiplied by the number of events.

The argument that decides it, though, is specific to this table: **it cannot be
corrected.** A derived value written into an append-only log is wrong forever
the day the derivation is wrong, because the trigger refuses the fix. Derived on
read, repairing `pausedIntervals` repairs every session that ever ran.

A test writes a duplicate `paused` event and asserts the answer does not move.
That idempotence is the property `duration.ts` was built for and the one a
stored counter cannot have.

**The cost, stated rather than buried:** no `WHERE elapsed_ms > …` in SQL. F3.3's
signals read gaps between events, which is `occurred_at` arithmetic, so nothing
planned needs it. The column goes in when something does.

**Rejected:** computing it at write time. It would make the value depend on what
had been written, while `duration.ts` is explicitly built to depend on when
things happened — it sorts defensively because an idle autopause is stamped at
the last heartbeat, deliberately earlier than its write time. I looked for a case
where that produces a wrong number today and did not find one, so this is a
divergence the code itself documents, not a bug being claimed.

### DELETE is refused too, unless a transaction says otherwise

The spec says "No UPDATE, no DELETE on this table". Criterion #4 says deletion
must work. Account deletion cascades through `solve_sessions` into this table.
All three are real.

So the trigger refuses unless `quadrantcode.purging` is set, and one module sets it
— `server/services/timeline/retention.ts`. This is not enforcement by
convention: without the flag, no code path, no psql session and no cascade
removes a row. Setting it is a deliberate statement inside a transaction whose
purpose is erasure.

`set_config(_, true)` is transaction-scoped, so the flag cannot leak onto a
pooled connection. A test asserts the log is **still append-only after** a
deletion, because that leak is the failure that would otherwise rot silently.

**This cost is real and it was measured:** ten browser tests failed when the
trigger landed, all of them cascading deletes in fixture teardown. The same
cascade is what account deletion runs, so the failures were the price arriving a
day early rather than in production.

**Rejected:** a trigger on UPDATE only. It satisfies the written criterion and
abandons the sentence beside it, and it leaves a log where a stray `DELETE` in a
migration silently drops a user's history with nothing objecting.

### The diff engine is written, not installed

`diff`'s `applyPatch` is deliberately fuzzy — it searches nearby lines when
context no longer matches, because it exists to apply human patches to files
that have drifted. For a criterion that says **byte-identical**, that tolerance
is the whole problem: a near miss returns code the user never wrote, with
nothing to indicate it.

These operations carry no context, so there is nothing to match fuzzily.
`applyDiff` walks them exactly or throws — including on a diff that leaves the
source half-consumed, which is the dangerous case, since dropping a tail yields
plausible code.

Newlines are content: `"a\nb"` and `"a\nb\n"` are different files and round-trip
differently. Nothing trims, normalises CRLF, or adds a final newline, because a
diff engine that tidies its input cannot rebuild its input.

**Rejected:** storing every version whole. Simpler and correct, and it is what
the code falls back to when a diff would be larger than the file it describes —
which happens on genuinely small sources and is why a later snapshot is allowed
to be full. Storing every version that way is what the ticket's storage
projection exists to rule out.

### Drafts and snapshots are different things, not two copies of one

D24 deferred F3.1's "server snapshot every 60s" to this ticket rather than
building a second home for the user's code. That resolves here: localStorage
holds the **draft** — latest text, per browser, so a reload loses nothing —
while `code_snapshots` holds the **history**, server-side and immutable. One is
overwritten constantly and belongs to a device; the other belongs to a sitting.

---

## D26 · Vercel Queue dispatches IDs; Neon owns execution truth

**Context:** In-process execution cannot survive a serverless suspend. Automatic
provider failover can execute the same untrusted submission twice, while a queue
and a relational transaction cannot atomically commit together.

Vercel Queue push mode carries only a version and execution job UUID. The Neon
row is also a transactional outbox: it is committed before publishing, the UUID
is the Queue idempotency key, and a daily authenticated reconciler republishes
undispatched rows. At-least-once delivery is fenced by an atomic row claim,
75-second renewable lease and unique `run_attempts.job_id`; learning effects and
terminal completion share the attempt transaction.

Vercel Sandbox is the explicit production backend. A submission gets one
ephemeral, network-denied VM and is compiled once. Cases get separate temporary
workspaces, while expected output stays in the consumer. Judge0 remains an
explicit optional selection, never automatic fallback. Fake execution is local
only and cannot pass production configuration validation.

**Cost:** a crash after Neon commit but before Queue publish can wait for the
Hobby plan's daily cron, and a crash after Sandbox execution but before database
finalization can spend duplicate CPU. Database effects remain exactly once.
Keep the feature disabled until the digest-pinned image proves its cgroup,
namespace, egress and cleanup contracts in a controlled preview.

---

## D27 · The native library is ten problems in a hundred skins, and it is not shipping

**Date:** 2026-09-17 · **Status:** the library is held at `needs_review`,
permanently, and is being replaced with hand-authored problems.

### What the documents claimed

`docs/status.md` said "Exactly 100 **independently authored** DSA problem
records, with the required 35 easy / 45 medium / 20 hard and topic
distribution." The README said "100 original native DSA problems". Both were
false, and both survived multiple passes of this project's own honesty edits
because the _count_ was right and nobody measured the _content_.

### What it actually is

Measured across all 100 records in `data/native-problems/`:

| Field                                       | Unique values |
| ------------------------------------------- | ------------- |
| slug, title, statement, story               | 100           |
| primary topic                               | 10            |
| **test cases** — all 500, hidden included   | **10**        |
| **reference solutions**                     | **10**        |
| editorials · hints · constraints · examples | 10 each       |
| **function contract**                       | **1**         |

Every problem is `solve(values: integer[])`. The records collapse into ten
groups by test-case identity: 15 / 12 / 12 / 12 / 10 / 8 / 8 / 8 / 8 / 7. Group 1
is fifteen records all taking the input `4 4 2 4`, named _Signal Frequency
Ledger_, _Archive Duplicate Pulse_, _Warehouse Mode Counter_, _Telemetry
Majority Meter_, and eleven more. The prose is genuinely distinct. The problem
is one problem.

They were produced by `scripts/generate-native-problem-library.ts`. "Authored"
was never the right word.

The 20 papers in `data/assessment-papers.json` have 20 distinct slugs and titles
over **10** unique question-sets and **10** unique instruction texts, each used
twice, and every question resolves into the pool above.

### The part that would survive contact with a reviewer worst

**The difficulty labels are cosmetic.** Each of the ten groups spans easy,
medium _and_ hard while sharing byte-identical test cases, constraints and
reference solution. The aggregate is exactly 35 / 45 / 20 — the distribution the
spec asked for — so a reviewer checking the requirement finds it satisfied. It
measures nothing: `difficulty` is a property of the skin, not of the problem,
and `difficultyCalibration` inherits the same defect.

Had this been published, difficulty filters would have returned mixed groups,
`estimatedMinutes` baselines would have been incomparable within a group, and
every analytic that segments by difficulty — weak-topic scoring, the revision
engine's risk model — would have been reading noise. It is the kind of number
that looks correct in a table and falls apart under one question.

### Decision

1. **The library is not published.** All 100 problems and 20 papers import at
   `needs_review`; `server/services/problems/queries.ts:76`,
   `server/services/native-content/public.ts:76` and
   `server/services/companies/queries.ts:164,240` all gate on `published`. No
   user can reach any of it. Nothing needs to be deleted for that to hold.
2. **The documents were corrected rather than quietly softened.** Both false
   lines are struck through in place with the measurement beside them, so the
   claim and its correction stay visible together.
3. **`npm run companies:seed` was added** to populate `/companies` without it.
   The ten company records are the one non-generated piece here.

### Rejected: import it anyway, publish nothing, fix the docs

Tempting, because the visibility gate already holds and the empty `/companies`
message is what prompted this. Rejected because the papers cannot be imported
without the problems — `importAssessmentPaperLibrary` resolves every
`problemSlug` to a row and throws when one is missing — so "import it all, show
none of it" means inserting 100 problem rows, 500 test cases and 20 papers that
are all destined for deletion, into the same table the hand-authored problems
will land in. Seeding ten companies is the smaller and more honest move.

### Rejected: delete `generate-native-problem-library.ts`

The generator is not the fault. A generated library is a reasonable way to
exercise an importer, a review queue and a publish gate — and that machinery
_is_ real and does work, which is the salvageable outcome here. The fault was
describing its output as authored. The script stays; the claim does not.

### What to watch for

The failure was not the generator and not the data. It was that **every check
this project ran counted records and none compared them.** `native:validate`
passes 100/100 because each record is structurally valid. The 35/45/20
distribution passes because the labels are present. A cheap guard against the
next instance of this is a distinctness assertion — unique test-case sets should
be within some factor of record count — but none is written yet, and writing one
against a library that is being replaced would be guarding the wrong thing.

---

## D28 · A hash proves nothing about a schema, and two functions prove nothing about a database

**Date:** 2026-09-19 · **Status:** production was **not** rebuilt. The drift
verdict is withdrawn — it was wrong. `schema:check` now decides on the schema,
and reports hashes as provenance only.

### What the scripts claimed

Two checks ran against the production database within an hour of each other and
returned opposite verdicts, both stated as facts about the whole schema:

| Script                          | What it measured       | What it printed                                             |
| ------------------------------- | ---------------------- | ----------------------------------------------------------- |
| `.tmp/prod-schema-check.mts`    | 2 trigger functions    | "CURRENT. Production matches the migration files"           |
| `schema:check` as first shipped | 2 triggers + 25 hashes | "DRIFTED. This database does not match the migration files" |

The first gave a false all-clear that was acted on. The second blocked a
production seed that never needed blocking. **Neither sentence was earned by
what the script looked at**, and the only signal either one genuinely observed —
the triggers — agreed in both runs and was correct all along.

### What a migration hash actually is

`node_modules/drizzle-orm/pg-core/dialect.cjs`:

```
select id, hash, created_at from ... order by created_at desc limit 1
if (!lastDbMigration || Number(lastDbMigration.created_at) < migration.folderMillis)
```

The migrator reads **one** row and compares **timestamps**. The `hash` column is
written at application time and **never read for any decision**. Therefore:

- A **mismatched** hash means a file changed after it ran. It says nothing about
  the live schema, does not affect future migrations, and Postgres never
  consults it.
- A **matching** hash proves nothing either. A hand-run `ALTER TABLE` leaves all
  25 rows agreeing while the schema diverges.

A hash cannot answer a question about a schema in either direction. Only the
schema can.

### What production actually was

Every one of the 25 recorded hashes resolves to the byte-for-byte content of a
migration file in this repository. Eighteen resolve to the **CRLF** form of
**today's** content, three to the LF form, and four to files with no line breaks
at all, where the two forms are the same string. **Nothing was unaccounted for.**

```
LF 7   CRLF 18   neither 0
```

Production was migrated from a partially CRLF working tree — consistent with the
incident already recorded in `.gitattributes`, where `core.autocrlf=true` on a
Windows clone rewrote 323 files and took `format:check` from clean to 254
failures. The "18 of 25 drifted" reading was **a line-ending artifact reported as
schema damage.**

### The same failure as D27

D27 was a count that was right about records and never compared their content.
This is the same shape one level down: a comparison that ran, produced a number,
and had that number written up as a conclusion it could not support. In both
cases the check was real, the arithmetic was correct, and the _sentence attached
to it_ was the defect. The cost here was a false all-clear, then a false alarm
that halted a deployment step, and a development database rebuilt — destroying
the specimen — before anyone asked what its numbers meant.

The rule both leave: **state what was measured in the same breath as the
verdict.** `schema:check` now ends with "That is what was checked — not the whole
schema. Columns, constraints and indexes are not compared here," because a reader
should not have to open the source to learn the scope of a pass.

### What is still true, and what is not

Still true: applied migrations are immutable, `dac85c8` did edit four of them in
place (`0001`, `0015`, `0019`, `0020`), Drizzle cannot detect that, and a
database that took the pre-rename `0015` has a trigger reading `traceloop.purging`
that refuses every legitimate erasure. That was real, and `quadrantcode_dev` had
it.

Not true: that production was affected. Its triggers are correct, its migration
record is complete, and the only difference is how a line ending was encoded on
the machine that ran it.

---

## D29 · Copied example inputs: cleaned at the tip, left in history, and why the rewrite waits for the repo to go public

**Date:** 2026-09-22 · **Status:** tip cleaned. **History deliberately NOT
rewritten.** The rewrite is a precondition of going public, recorded here so it
is not rediscovered at the moment it becomes urgent.

### What was found

Eight numeric example inputs copied from an external platform — `2 7 9 3 1`,
`1 2 3 1`, `2 1 5 6 2 3`, `2 4`, `4 3 2 6`, `5 10 -5`, `8 -8`, `10 2 -5` — with
their matching outputs. A C1/C2 breach, but a narrow one, and the distinction
matters for the remedy: **the statement prose was never copied.** The stories,
formats, constraints and explanations in those records are Quadrantcode's own
templated boilerplate. What was taken was example data.

Measured with exact match after whitespace normalisation, not substring —
`2 4` appears inside `12 41`, and any substring scan reports noise as findings.

| Where                                                      | Count                                                                                                                                                      |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `data/native-problems/retired/batch-{04,05,07,09,10}.json` | 76 fields in 22 records — 38 in `examples[].input`, 38 in `testCases[].input`                                                                              |
| `test_cases.input` (production)                            | 45 rows                                                                                                                                                    |
| `problem_examples.input` (production)                      | 46 rows                                                                                                                                                    |
| `problems.examples` JSONB entries (production)             | 38, all on archived problems                                                                                                                               |
| Affected problems                                          | 26 — 22 archived, 4 published                                                                                                                              |
| User history attached to any of them                       | **zero** rows in `solve_sessions`, `user_problems`, `run_attempts`, `revision_schedule`, `execution_jobs`, `assessment_paper_questions`, `import_job_rows` |

Nothing was ever served. The four published problems held theirs on **v1 only**
and all four are `current_version = 2` — residue of the PR #10 statement
rewrites, surviving because `problem_versions` rows are not edited in place. The
solve page reads `currentVersion` and requires `status = 'published'` on the
version; the admin export filters to current versions. Verified by query, with a
positive control proving the query reached data (98 test cases on current
published versions) rather than returning zero because it was pointed at nothing.

### What was done

1. **The four published problems' v1 rows** took the approved v2 input, output
   and explanation at the matching ordinal — 8 examples and 7 test cases.
   Ordinals lined up one-to-one in all four, checked before writing. Copying all
   three fields rather than blanking the input was the point: the v1 explanations
   embed the numeric result (_"…the computed result is 12"_), so replacing an
   input alone would have left a row that states a falsehood. A blanked input
   removes the breach and creates a lie.
2. **The 22 archived problems were left alone.** Unreachable by every code path,
   no user data, and step 3 closes the only route by which they could come back.
   A write with no reader is a write that can only go wrong.
3. **The five retired batch files were deleted from the tip.** 42 records. The
   other 42, in `batch-{01,02,03,06,08}.json`, hold nothing copied and stay.
   `data/retired/assessment-papers.json` also stays — papers reference problems
   by slug and contain none of the eight.

### What the delete cost, and what was not done about it

The retired corpus was load-bearing for `importer.test.ts`, which used it as the
idempotency corpus. The delete broke it three ways: surviving batch numbers run
1, 2, 3, 6, 8 and `validateNativeLibrary` rejects a gap; the surviving records
cover 5 of 10 topics, below the floors; and 40 of the retired library's 80 paper
questions now dangle.

**None of those were fixed by editing retired content.** Renumbering the files to
close the gap would rewrite records precisely to keep a test alive, which inverts
what the test is for. Instead the importer test now runs over the active sixteen,
and `importAssessmentPaperLibrary` keeps its coverage through a fixture library
built in the test and parsed by the real `assessmentPaperLibrarySchema` — so the
twenty-paper, two-per-company, hundred-mark rules being exercised are the shipped
ones, not the fixture's own idea of them.

`retired-library.test.ts` lost its `=== 84` assertion. A count is the wrong guard
for a folder whose purpose is to shrink: it needs editing every time a record
leaves, which turns it into a chore, and a chore gets edited to match whatever
happened rather than to state what should be true. What replaced it is
non-vacuity (`retired.length > 0` before a `not.toContain` loop that would
otherwise pass over an empty list) and a check that surviving records are still
whole records rather than hollowed-out stubs.

### Why history is not being rewritten now

The copied data is in **4 commits** — earliest `c49c2ff` (2026-09-08), latest
`31b3fc4` (2026-09-22). Deleting the files from the tip does not touch any of
them. That is stated plainly rather than implied, because the tempting version of
this entry is one that reads as if the problem is solved.

Rejected: `git filter-repo` now. The cost, counted:

- **169 commits on `main` get new SHAs**, from `c49c2ff` forward.
- **13 remote branches** need force-pushing; 8 of them contain `c49c2ff`.
- Every commit hash cited in `docs/decisions.md`, `docs/acceptance-status.md`,
  `CLAUDE.md` and merged PR bodies becomes a dangling reference.
- **It would not actually remove the data from GitHub.** `refs/pull/7|8|9|10/head`
  all still hold it — verified by fetching each ref and grepping it. Those refs
  are GitHub-owned and cannot be force-pushed or deleted by the repository owner.
  After a rewrite the old objects stay reachable by SHA through the web UI and
  API until GitHub Support runs GC on the repository.

Against that: the repository is **private**, has been private since it was
created on 2026-08-13, and has **0 forks, 0 stars, 0 watchers, 0 deploy keys and
one collaborator** — the owner. Nothing has ever been fetched by a third party,
so there is no search index, fork or archive copy to chase. The rewrite buys
nothing today and breaks a large number of references.

### The precondition on going public

`CLAUDE.md` says the repo is _"private until there is a real README, then
public."_ **That flip is the moment this becomes real**, and it must not be done
casually. Before it:

1. Run `git filter-repo` in **one pass** over all refs (not installed;
   `pip install git-filter-repo`. BFG is the weaker tool here — it selects blobs
   by size or name, and this needs selection by content).
2. Force-push every branch, and fix the commit hashes cited across the docs.
3. **File a GitHub Support request to garbage-collect stale `refs/pull/*`
   objects.** Without this step the rewrite is cosmetic. This is the part that
   cannot be done from a terminal, and it is the part with a lead time.

Until all three are done, the repository stays private. A public repo with the
history unrewritten is strictly worse than a private one with it, because it
converts a contained problem into an indexed one.

### The shape to notice

This is the third entry in this file about a verdict outrunning its evidence,
and the first where the failure was caught mid-investigation rather than after.
The first sweep of git history reported **0 commits** for every copied string.
That number came from `git log --all -S"…" --pickaxe-regex=false` with stderr
sent to `/dev/null` — `--pickaxe-regex=false` is not a flag, git exited on the
parse error, and `wc -l` counted the empty output as a clean result. A positive
control — a string known to be absent, which must return 0, run alongside strings
known to be present, which must not — is what separated the two cases.

Same shape as D27 and D28: the check ran, produced a number, and the number was
about to become a sentence it could not support. **The control is not optional on
an "X is absent" check.** It is the only thing that distinguishes absence from a
broken query, and a broken query looks exactly like good news.

---

## D30 · Preview gets its own database, and the one variable that still names production

**Date:** 2026-09-22 · **Status:** preview builds pass. One cleanup item left
open deliberately, recorded here rather than fixed, because fixing it needed a
secret this session could not read.

### The Vercel check had been red on every PR

Not flaky, and not this PR: `deploy:check` ran before the build and failed with
`DATABASE_URL: Invalid input: expected string, received undefined`. Preview had
no database. The standing answer had been to leave it, which meant every PR
carried a red check, and a permanently red check stops being read.

Fixing it turned up a second failure waiting behind the first, and the second
one is the interesting half.

### `NEXT_PUBLIC_APP_URL` cannot be set correctly for Preview

`check-deployment-env.ts` requires it to be a non-localhost HTTPS origin.
Vercel mints a hostname per deployment and does not interpolate environment
variable values, so:

- Setting one value for the Preview environment is correct for at most one
  branch and wrong for every other.
- Leaving it unset falls back to the `http://localhost:3000` default in
  `lib/env.ts`, which the check rejects by design.

There was no value that worked. Rejected alternatives: a fixed placeholder
origin (satisfies the check while making every preview link point at a host
that is not the one you opened) and a per-branch env var (green on this branch,
red on the next, and a manual step forever).

`lib/deployment/origin.ts` resolves it from Vercel's own build-time variables
instead — `VERCEL_BRANCH_URL` first because it is stable for the branch,
`VERCEL_URL` as fallback.

**Scoped to `VERCEL_ENV === 'preview'` on purpose, and there is a test for that
direction specifically.** Production must keep failing when
`NEXT_PUBLIC_APP_URL` is missing: it is what auth callbacks, emailed links and
share cards are built from. Inferring it there would convert a failed build
into a silently wrong deployment, which is the more expensive outcome. The
useful question about a fallback is not "does it fix the error" but "what does
it hide", and on production it would hide the thing most worth seeing.

### Preview's database

Neon branch `preview-db` (`br-spring-violet-b3veqw2q`), branched from
production, then every user-owned table cleared **on the branch only**: 79
session_events, 44 solve_sessions, 2 users, and eighteen more. The 12 content
tables came through matching production exactly, so previews still have the
full catalogue to render. Production was re-counted afterwards and was
unchanged.

Two things fought back, and both are recorded elsewhere as known behaviour:

- `session_events` refuses DELETE without `quadrantcode.purging` set inside the
  transaction (D25).
- **`audit_logs` has no purge flag at all.** Its `BEFORE DELETE` trigger always
  raises, which rolled the entire first attempt back — nothing was deleted until
  the second run. It was cleared with `TRUNCATE`, which does not fire row
  triggers. That is exactly the gap `docs/security-audit.md` lists as an
  accepted risk, used deliberately on a disposable branch. On production it
  remains the reason a least-privilege database role is the highest-value
  hardening change.

### The cleanup item: `DATABASE_URL_UNPOOLED`

**Vercel holds it as a SINGLE entry targeting Production and Preview**, so it
cannot carry a different value per environment, and on Preview it resolves to
production.

Repointing it for Preview alone would mean deleting that shared entry and
re-adding two. The Production value cannot be read back without printing a
secret, so the delete would have been irreversible from inside this session.
**Deleting a secret that cannot be restored is not a step to take to tidy a
variable**, so it was not taken.

What was done instead: a Preview-scoped `DIRECT_DATABASE_URL`, plus
`server/db/direct-url.ts`, which declares the precedence once —
`DIRECT_DATABASE_URL` → `DATABASE_URL_UNPOOLED` → `DATABASE_URL` — and is used
by all six consumers.

That unification was not cosmetic. Two orderings existed:
`drizzle.config.ts` and `migrate.ts` read `DIRECT_DATABASE_URL` first, while
`seed.ts`, `seed-companies.ts`, `import-native-problems.ts` and `rollback.ts`
went straight to `DATABASE_URL_UNPOOLED`. **A seed or a rollback run with
preview credentials loaded would have reached past the preview database to the
production one**, with nothing in the output saying which it had picked. Half
the tooling pointing at a different database than the other half is the kind of
defect that is invisible until it is expensive.

Verified by running `db:migrate` against the preview branch with
`DATABASE_URL_UNPOOLED` and `DATABASE_URL` both set to an invalid host: it
connected to preview regardless. That is the precedence working, rather than a
claim that it does.

**Still open.** `DATABASE_URL_UNPOOLED` is shadowed, not corrected. Closing it
takes a hand: delete the shared Vercel entry, re-add the Production value from
your own copy, add a Preview-scoped one. Low urgency — nothing reaches it now —
but it is the one remaining place where a Preview context names production, and
that is a sentence that should not stay true indefinitely.

### Branch protection

`main` now requires the two Actions jobs and nothing else. **Vercel is
deliberately not required**: it depends on a third party and on environment
configuration, and a required check that can go red for reasons unrelated to
the code is a check people learn to override.

Force-push and delete are blocked, with `enforce_admins` off so an admin can
still bypass. That combination is load-bearing rather than incidental — D29's
eventual `git filter-repo` pass needs exactly that force-push, and a protection
rule that made the recorded plan impossible would be a rule quietly overruling
a decision.

---

## D31 · C3 covered the wrong table, and the guard table said otherwise

**Date:** 2026-09-22 · **Status:** fixed. Full analysis in
`docs/c3-company-associations.md`; this entry records what was decided and what
it cost.

### The finding

`CLAUDE.md` listed C3 as enforced at the database by
`problem_tags_company_style_suffix`. That CHECK is real, and it constrains
`problem_tags`. **Company associations are in `problem_company_evidence`**, which
it does not touch.

So the solve page rendered `{company.name} · {EVIDENCE_TYPE_LABELS[type]}` —
"Amazon · Company pattern", hyperlinked to that company — with no `-style`
suffix, no CHECK, no test, and no disclaimer on the route. The disclaimer sat on
all five `/companies/*` pages, which is the surface that needs it least.

Worse than any of that: **four of six evidence types assert real provenance**
(`official_sample`, `verified_pyq`, `candidate_reported`, `frequently_reported`)
and nothing forbade them. One admin action could have put "Verified PYQ" on a
problem with no review workflow behind the claim.

### Why the existing CHECKs were not the guard they resembled

```sql
evidence_type not in ('official_sample','verified_pyq')
  or (source_url is not null and verification_status = 'verified')
```

This makes a provenance claim **well-formed**, not permitted. It is a sound rule
for a platform that intends to make such claims after review. Mistaking it for a
C3 guard is easy and was the trap here — it mentions `verified_pyq`, it lives on
the right table, and it does nothing to stop the row existing.

**A constraint that names the dangerous value is not the same as a constraint
that forbids it.** That is the reusable part of this entry.

### Decided

1. **Solve-page chip: `-style`, and no link.** Both halves matter. The suffix is
   the letter of C3; dropping the link is the spirit, because a hyperlink implies
   something authoritative sits behind it. `/companies` keeps its links — it
   opens with the disclaimer and is self-evidently an index.
2. **Block the four provenance types at the database** —
   `problem_company_evidence_no_unreviewed_provenance`. Rejected: removing them
   from the `pgEnum`, because that is a painful migration, where relaxing a CHECK
   is one line the day a review workflow exists.
3. **Leave the 104 existing rows alone.** All `company_pattern`, all still legal.

### The consequence that was not in the plan

Blocking four types made the `/companies/[slug]` **filter dropdown offer four
options that can never match a row**, and its "Evidence labels" legend describe
four claims the platform cannot make. A UI asserting something the database
forbids is the same defect as the guard-table row that started this — a stated
capability that is not real.

So `PERMITTED_EVIDENCE_TYPES` is declared once in `lib/native/constants.ts` and
drives the dropdown, the legend, and the constraint test. The test iterates the
full enum and asserts accept-**iff**-permitted, so the constant and the CHECK
cannot drift apart: widening one without the other fails. Verified by doing
exactly that — adding `verified_pyq` to the constant made the test fail, and
removing the CHECK from the migration made the rejection fail while its control
still passed.

`tests/companies/queries.test.ts` had a `candidate_reported` fixture, now
`unverified`. Worth noting rather than hiding: a fixture using a value the schema
forbids is testing a row that cannot exist.

### Not done

No review workflow, and the enum keeps all six values. The day verified past
questions become intended content, the change is dropping one CHECK and widening
one array — and the test will insist both happen together.

---

## D32 · Confidence was collected after the schedule it was meant to inform

**Date:** 2026-09-23 · **Status:** both completion paths now collect it. **The
reflection path still does not re-schedule, deliberately** — recorded below with
the problem that makes it a decision rather than an oversight.

### Two of the ladder's five rules had never fired

`scheduleAfterSolve` reads confidence harder than any other signal: `'low'`
selects the compressed ladder outright, and `'high'` is a precondition of
`clean-and-quick`, the only rule that lengthens a gap.

Nothing collected it before the schedule row was written.

- `TimerBar.onComplete` was typed `{ sessionId, outcome }`. No confidence field
  existed on the prop, so the Solved button could not have sent one.
- `ReflectionForm` does ask — on `/sessions/[id]/reflect`, which the user reaches
  **after** `completeSession` has already run `scheduleAfterSolveTx`.
- Nothing under `server/services/reflection/` references `scheduleAfterSolve`.

So the value was captured one step too late, every time, and the ladder ran on
`failed-attempts` and `slow-solve` alone — `hints-used` being inert because F3.4
is cut. Combined with D31's finding that accepted submits passed placeholder
signals, the scheduler had been operating on a fraction of its inputs.

**A unit test of `scheduleAfterSolve` would have passed throughout.** The
function was always correct; the wiring never reached it. That is why the test
added here drives `completeSession` against a real database and reads the
persisted `revision_schedule` row — the assertion has to span the link that was
broken, not the end of it that worked.

### Asking without building a confirmation dialog

`TimerBar` records a deliberate decision that Solved is unconfirmed: _"a dialog
in front of the ordinary success path is the thing that teaches people to
dismiss dialogs without reading them, which would blunt this one."_ That
reasoning is sound and this does not overturn it.

`ConfidencePicker` is therefore not a confirm/cancel gate. Every option,
including `Skip`, completes the action; it asks on the way past rather than
standing in the doorway. `Skip` sends `undefined` rather than a middle rating,
because a rating standing in for silence is worse than silence — the ladder
would read it as a real answer.

### The same three values, in four places

Fixing the client boundary surfaced a duplication. `'low' | 'medium' | 'high'`
was written out in `server/db/schema/enums.ts` (the `pgEnum`),
`session/lifecycle.ts`, `revision/ladder.ts` and `reflection/reflection.ts` —
four declarations that must agree and cannot see each other.

The picker is a client component, and `components/` may not import from
`server/` (deny-by-default, F0.1), so the type had to move to `lib/` or be
written a fifth time. It moved: `lib/session/confidence.ts` is now the source,
`pgEnum` is built from it, and `db:generate` reports **"No schema changes"** —
the refactor is byte-identical SQL. Same shape as D21's taxonomy.

### Rejected for now: re-scheduling after a reflection

The obvious completion of this work is to have `saveReflection` re-run
`scheduleAfterSolveTx` when it captures a confidence the completion did not.
It is **not** done, because it is not a simple re-run.

`scheduleAfterSolveTx` steps from `existing?.ladderIndex ?? 0` — it continues
from where the problem already sits, deliberately, so that solving a problem
again does not drop a months-old interval back to one day. Calling it a second
time for the _same_ solve would therefore step from the rung the first call just
wrote, compounding rather than correcting: a `'high'` answer after a schedule
already advanced by `clean-and-quick` would advance it twice for one solve.

Doing it properly needs one of:

1. **Recompute from a remembered starting rung**, which means storing the
   `fromIndex` each schedule was derived from.
2. **A distinct "revise this schedule" entry point** that replaces rather than
   steps, with its own rules about what a late answer may change.
3. **Collect confidence only at completion** and treat the reflection's copy as
   commentary, which is effectively what shipping this change does.

(3) is the status quo after today and is coherent: both completion paths now
ask, so the common case is covered, and the reflection answer remains a record
of what the user thought rather than an input to a schedule already written.
Revisit if reflection-time answers turn out to differ materially from
completion-time ones — which is now measurable, because both are stored.

### hints-used: kept dormant, and tested

F3.4 is cut, so `hintsUsed` is always 0 and the rule cannot fire. Kept rather
than deleted: it is an always-zero _input_, not a guard giving false assurance,
so it misleads nobody, and deleting it would mean re-deriving the rule from the
spec when F3.4 returns. The price of keeping it is a test proving it still
compresses when a hint is used, so the branch is not merely trusted.

---

## D33 · Wrapper shapes: the order, what each one costs, and what shape 1 unblocks

**Date:** 2026-09-23 · **Status:** plan, agreed before building. Shape 1 only;
shapes 2 and 3 wait until shape 1 has landed and been used.

Recorded here rather than in a PR body because the ordering and the migration
list outlive any one PR, and because the previous version of this plan existed
only in a conversation — which is exactly the failure `CLAUDE.md`'s "a missing
artifact is missing, not absent" rule is about. Everything below is derived from
the library and the registry, not from recollection.

### Why a shape at all

`server/services/native-content/wrapper-shapes.ts` holds the per-language
execution contract once, instead of each record carrying its own byte-identical
copy. A record names a `shape` and supplies only `referenceSolution` per
language. Measured across the old hundred-record library that removed 117,900
bytes of duplication.

**One shape exists: `int-array-to-int`.** All 16 active problems use it, and all
16 therefore declare the identical contract:

```
solve(values: integer[]) -> 64-bit integer
```

### What a shape supplies: seven fields, five languages

From `ShapeTemplate` in `wrapper-shapes.ts` — these are the seven, exactly:

| #   | Field               | What it is                                               |
| --- | ------------------- | -------------------------------------------------------- |
| 1   | `displayName`       | The language's name in the picker                        |
| 2   | `runtimeVersion`    | Pinned runtime label, or null                            |
| 3   | `judge0LanguageId`  | Pinned Judge0 id, or null                                |
| 4   | `functionSignature` | The signature shown above the editor                     |
| 5   | `starterCode`       | What the editor opens with                               |
| 6   | `wrapperTemplate`   | Reads stdin, calls the solver, prints the result         |
| 7   | `serialization`     | `{ input, output, equality }` — how a verdict is decided |

Five languages — `c11`, `cpp17`, `java`, `python3`, `javascript` — so **35
pieces per shape**, each of which has to be proven against a real problem in
that language. `docs/authoring-problems.md` §2 budgets **about a day per shape**,
and that is the estimate this plan adopts rather than a more optimistic one.

### The ordering, and the evidence for it

**`int[] + int` → `string` → `graph n + edges`.**

Chosen by how much each unblocks per day spent, measured against what the
library already contains.

**Shape 1, `int[] + int`, fixes six records that are lying about their input
today.** Six of the sixteen smuggle a scalar into `values[0]`, and their own
`inputFormat` text says so:

| Problem                     | What is smuggled into `values[0]`     | Difficulty |
| --------------------------- | ------------------------------------- | ---------- |
| `kiln-soak-window`          | the soak length (window size)         | medium     |
| `museum-ticket-pair-count`  | _"values[0] is the target"_           | easy       |
| `sorted-dock-insertion`     | _"values[0] is the query target"_     | easy       |
| `ferry-weight-rating`       | how many crossings (days)             | hard       |
| `donation-target-subsets`   | _"values[0] is a nonnegative target"_ | easy       |
| `pipeline-segment-from-end` | _"values[0] is k"_                    | easy       |

Two of those statements name the array index in prose. That is the wrapper's
limitation leaking into the problem text, where a reader meets it as though it
were part of the puzzle. It is the clearest signal in the library that this
shape is the one to build first.

`functionContract.parameters[0].description` currently reads _"The complete
integer encoding described by this problem"_ — a description that exists because
there is nowhere else to put the second argument.

**Shape 2, `string`, migrates nothing — it unblocks new authoring.** Every one
of the 16 records is `integer[]`; there is not a single string problem, because
there has been no way to write one. So its value is entirely in what comes next,
which is why it is second rather than first: shape 1 repairs existing records,
shape 2 widens the catalogue.

**Shape 3, `graph n + edges`, is last because it is the most work for two
records.** Candidates:

- `constellation-connection-groups` — _"values[0] is node count n. Remaining
  values are endpoint pairs for undirected edges"_
- `decision-tree-levels` — a level-order binary tree flattened into an int array
  with `-1` for a missing node

A tree may want its own shape rather than sharing the graph one; that is decided
when shape 3 is built, not now.

### Migration is a new version, not an edit

Each migrated problem becomes **version 2**. All six are still at v1 — the
2026-09-22 rewrites took five OTHER records to v2, and none of those five is a
shape-1 candidate. (An earlier draft of this plan said v3, from assuming the
whole batch had moved.) `problem_versions` rows are not edited in place,
and the live path reads `current_version`, so the old version stays as the record
of what was served.

Each migrated record gets:

1. **A rewritten statement** — except `kiln-soak-window`, which already
   describes stdin the way the house style should and needs only its contract
   changed. The `values[0] is the target` sentences elsewhere exist only to
   describe the workaround and must not survive the shape that removes the need
   for them.
2. **Descriptive function and parameter names.** Every one of the 16 currently
   declares `solve(values)`. A contract that can express two arguments should
   name them — `countPairs(prices, target)` rather than `solve(values)` — and the
   generic name was itself a symptom of the single-argument shape.
3. **Re-validated reference solutions** in all five languages, since the
   signature changes.

### Amendment · a shape holds STRUCTURE; a record holds NAMES

The first version of this plan asked for descriptive names without checking
where a signature comes from, and it comes from two places that must agree:

| What                               | Lives on                                            | Rendered by                                    |
| ---------------------------------- | --------------------------------------------------- | ---------------------------------------------- |
| `functionSignature`, `starterCode` | the **shape** — identical for every record using it | the editor                                     |
| `functionContract`                 | the **record**                                      | `ProblemPanel`, as `name(params) → returnType` |

`expandShape` copies the shape's templates verbatim and swaps in only
`referenceSolution`. Today both sides say `solve(values)` and agree by accident
of being equally generic. Giving a record `countPairs(prices, target)` while the
shape still supplied the signature would have made the statement panel and the
editor **contradict each other** — and a contract mismatch is worse than a
generic name, because the reader cannot tell which one the grader believes.

Rejected: one fixed signature per shape (`solve(values, k)` for all six). It is
cheaper and stays consistent, but it keeps `solve` forever and makes the name a
property of the wrapper rather than of the problem.

Rejected: placeholders for the new shape only. Two shapes with different rules
about where names come from costs more later than it saves now.

**So the registry's contract changes.** `functionSignature`, `starterCode` and
`wrapperTemplate` carry placeholders — the wrapper included, because it has to
call the function by name — expanded from the record's `functionContract` during
`expandShape`. Applied to `int-array-to-int` in the same change, so there is one
rule.

The duplication argument that created this file is about the 35 template pieces
per shape, not about three identifiers. Names were never the thing being
deduplicated.

**The guard that matters is that the two cannot diverge.** A test asserting the
panel and the editor show the same name passes today for the wrong reason —
both strings happen to be `solve`. It is only a guard if it fails when they
differ, so it is written with a positive control: a record whose
`functionContract` disagrees with its expanded signature must be rejected, and
the test proves the rejection fires rather than assuming it.

### Difficulty floors shift, and it is not incidental

`server/services/native-content/schema.ts` records that `medium` sits at 4
rather than 6 because _"four difficulty corrections are still deferred behind the
shape work (connected components and subset-sum both move up)"_.

So migration changes the distribution. `donation-target-subsets` (subset-sum) is
a shape-1 problem and moves up; `constellation-connection-groups` (connected
components) is a shape-3 problem and moves later. **The floors must be re-based
in the same change that moves a problem**, and the two distribution tables must
still sum to the same number — there is a test asserting that, because the
schema fixture zips them positionally.

### Structured testcase inputs land after shape 2, not now

Today a test case is a flat whitespace-separated line, which is why a scalar can
be smuggled into it at all. Structured inputs — a JSON object per case, with
named fields — are the general fix.

They wait until after shape 2 deliberately. Shapes 1 and 3 can express what they
need positionally (`values`, then the scalar; `n`, then edge pairs), but a string
argument alongside an integer array cannot be split on whitespace without a
quoting rule. Shape 2 is where the flat format actually breaks, so that is where
the replacement earns its cost rather than being built speculatively.

### Not in scope for shape 1

- Shapes 2 and 3. Agreed explicitly: shape 1 lands and gets used first.
- Structured testcase inputs, per above.
- `className` / method-on-class contracts. The schema has the field; no wrapper
  implements it; nothing in the library needs it.
- Migrating `one-counter-open`, `signal-frequency-ledger`,
  `cold-store-aisle-sweep`, `histogram-signal-block`, `strait-ice-floes`,
  `audio-track-merge-cost`, `rising-corridor`, `archive-shelf-reward` — these are
  genuinely `int[] -> int` and the existing shape describes them correctly.

### Built · the guard, and the floor choice

**The panel and the editor cannot disagree, and a test proves the refusal
fires.** Two checks in `nativeProblemSchema`, both needed:

- _Before_ expansion, `functionContract.parameters.length` must equal the shape's
  arity, read by `shapeArity` from the placeholders the signatures actually
  carry. Without it, a contract naming **more** parameters than the shape takes
  passed silently — the panel showed three, the editor two — and one naming
  **fewer** surfaced as a raw throw from `applyShapeNames` mid-transform rather
  than as an issue on the record.
- _After_ expansion, `findContractDivergence` requires every language's
  `functionSignature` to name the contract's function and each parameter as a
  whole word, and every name to be an identifier, because names are now spliced
  into code in five languages.

`tests/native-content/contract-divergence.test.ts` runs the agreement check on
the six records whose names are **not** `solve` — agreement between two sides
that both say `solve` proves nothing — and asserts each refusal. Positive
control: with both checks disabled, the four schema-level refusals fail, each
for its own reason (the "fewer" case turning back into the raw `__P2__` throw);
restored, all nine pass.

**Floors: easy 5 → 4, medium 4 → 5.** `donation-target-subsets` moved easy →
medium, and one unit of floor moved with it; both tables still sum to 12.
Lowering easy was not forced — 7 easy problems still clear 5. The alternative
that lowered nothing was medium 5 and one _topic_ floor raised to 2, but six
topics sit at 2 and choosing one would have been arbitrary. **A floor describes
the library; it does not protect a figure.** Connected components moves with
shape 3 and the floors move again then.

**Two escaping bugs in the new shape, caught before first use.** In a
single-quoted TS string `'\s'` is just `s`: the JavaScript wrapper split stdin
on `/s+/` — every submission would have parsed `NaN` — and the Java wrapper on
`"\s+"`, spaces only. Found by evaluating the emitted strings, not by reading
the source, which looked right.

**References are editorial, not minified.** Users read them. Guards the
constraints rule out were removed; two stay because a graded case reaches them —
`k > n → -1` in `pipeline-segment-from-end` (case `9 1 2`), and `n < 2` in the
C `countPairs` only, because `memcpy` from a zero-size allocation is undefined.

Validated locally without cache: 16 problems × 5 languages, 80 compilations,
535 executions, all matching. Validated on the live Judge0 instance on
2026-09-23, through the app's own `resolveProvider`, `wrapUserSource` and
`outputsMatch`: the six migrated records × 5 languages × every graded case,
**195 submissions, 195 accepted** — GCC 9.2.0 (C and C++), OpenJDK 13.0.1,
Python 3.8.1, Node.js 12.14.0. Python 3.8 cannot evaluate `list[int]` in a
signature; the wrapper's `from __future__ import annotations` is what makes the
shape's signatures legal there, and this run is the evidence it does.

---

## D34 · F2.2 comes back: revision modes, and blind retry enforced by omission

**Date:** 2026-09-24 · **Status:** built behind `FEATURE_REVISION_MODES`, off by
default.

### Reversing a recorded cut, deliberately

F2.2 was one of the eleven cut tickets, and `docs/project-summary-notes.md` said
"do not re-implement". On 2026-09-24 the owner re-scoped four of the eleven back
in — F2.2, F4.7, F4.2 and F4.5's upsolve queue, the ones that need no paid or
external service — one ticket at a time, each behind a flag and each reported
before the next. This is the first. The other seven cuts stand.

The flag was deleted on 2026-09-16 with the note "re-add one with its ticket,
not before". It is re-added here, with the ticket, and it is enforced: the mode
controls, the start action, the per-item context and the comparison are all
gated. With it off, `/revision` is F2.1's page exactly.

### The data: three nullable columns, no backfill

`solve_sessions` gains `revision_mode`, `speed_target_seconds` and
`speed_target_met`. Every existing session was an ordinary solve, and null says
exactly that, so migration `0026_revision_modes` is additive only — no default,
no backfill, no row touched. One CHECK,
`solve_sessions_speed_fields_consistent`, makes the three columns one fact: a
speed sitting has a positive target and nothing else has one; hit/miss exists
only on a finished speed sitting. Proved with a direct write the service never
makes.

**The speed target is stored, not recomputed**, because `min(previous best,
estimate)` moves the moment the sitting beats the previous best. **Hit/miss is
decided in `completeSession`** from the same event-derived duration the attempt
records, so the two cannot disagree, and a sitting that ends stuck is a miss
however fast it was.

### Blind retry: never loaded, rather than loaded and hidden

The ticket's rule is that previous code must not reach the client — "not in the
RSC payload, not in a props blob, not in a prefetched route". Four routes reached
it, and each is closed at the source:

| Route to the previous attempt                                                 | Closed by                                                                                                             |
| ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Attempt history on the solve page                                             | `getAttemptHistory` is not called for a blind sitting                                                                 |
| The editor's localStorage draft                                               | `draftKey` gains a scope; a blind sitting reads and writes `…:blind-<sessionId>` and never touches the unscoped draft |
| `/problems/[slug]`, linked from the timer bar on every screen, and prefetched | that page also skips the history while a blind sitting is live on the problem                                         |
| `sittingView`                                                                 | returns `{ mode: 'blind' }` and nothing else                                                                          |

The previous attempt comes back by itself when the sitting ends: the session is
no longer live, so the history loads again and the unscoped draft is untouched.

**Not gated on the flag.** A sitting only has a mode if the flag was on when it
started, and switching the flag off mid-sitting must not hand a blind retry its
previous attempt.

**Accepted:** `/sessions/[id]` (the timeline, which renders code) is reachable
by deliberately navigating to it. No link on the blind solve page or the problem
page leads there, so nothing prefetches it; a user who goes looking for their
old code has chosen to see it.

### What "retention" means in the comparison

A revision sitting is **measured** once the same problem has been attempted
again, and **retained** if that next attempt was solved. It is the only
retention signal the data holds without inventing one — revision outcomes are
counters on `revision_schedule`, not history. A revision with no later attempt
is unmeasured and left out, not counted either way.

Under ten measured revisions the page says "not enough data" and the count,
never a rate. Above it, every rate sits beside its own sample size, and a tie
names no winner.

### Smaller decisions

- **A mode requires a schedule row.** Revising means it was solved first; the
  refusal is the same for "never solved" and "not yours" (the F1.4 rule).
- **The pattern mini-set lists only what the user can open:** published, not
  premium (F4.4 is cut, so there is no entitlement to check), and originals only
  while `FEATURE_ORIGINAL_PROBLEMS` is on — the same helper the catalog uses.
- **`none` is not briefed as a mistake.** It is the taxonomy's "nothing went
  wrong".
- **Risk reasons already render as sentences** (F2.1's `label`), which was one of
  the ticket's criteria; nothing new was needed.
- The modes service has its own entry point, `revision/modes`, because it starts
  sessions through the lifecycle, which already imports the revision engine.

---

## D35 · F4.7a: public profiles, where the view type is the privacy contract

**Date:** 2026-09-24 · **Status:** built. Public profiles stay OFF per account
until the owner turns theirs on; there is no feature flag, because the per-user
opt-in already is the switch. F4.7b (landing, SEO, screenshots) follows as a
separate PR.

### Scope, and what the ticket asked for that is not built

The second of the four re-scoped tickets (D34). Built: a user-chosen handle,
`/u/<handle>`, a per-section toggle for each of the four sections, and a monthly
report card as an image at the three sizes the ticket names. **Not built, and
why:** "contest participation" (F2.5 is cut — there is nothing to show) and the
referral flow (bound to F4.3's anti-abuse conditions, and F4.3 is cut). Neither
is stubbed: a section with no data behind it would be the unverifiable claim
the ticket's own honesty rule forbids.

### The handle: chosen, not generated

Generating one from the display name or email was rejected because the email
route puts part of an address into a public URL. So `user_profiles.handle` is
nullable, the user chooses it, and **a public profile cannot be switched on
without one** — checked against the row as saved, inside the transaction, so a
stored handle counts and clearing it while public is refused.

One rule in two places, as one string: `HANDLE_PATTERN_SOURCE` in
`lib/profile/handle.ts` is both the Zod regex and the `user_profiles_handle_format`
CHECK. Lowercase-only is what makes the partial unique index case-insensitive
without a `lower()` expression. Reserved words (`admin`, `support`, …) are Zod
only: a list that grows does not belong in a CHECK.

**An absent field means "unchanged", never "default".** Onboarding saves through
the same schema without the new fields; a default there would have wiped a
chosen handle or re-shown a hidden section on every save. Tested directly.

### What a public profile may contain

`PublicProfileView` is the contract: a field that is not on it cannot reach the
page or a card. It has no email, **no bio**, no code, notes, mistakes or
reflections. The bio is left out because the disclosure the user agreed to —
rendered verbatim beside the toggle — names display name, avatar, and the
sections; the page shows what the user was told, not more. The disclosure was
updated to name the fourth section, longest streak.

Two details that would otherwise leak:

- **Avatar initials fall back to the email** when there is no display name.
  The public service passes an empty email, and falls back to the handle for
  the name, so neither can surface an address.
- **The stored streak is a cache (D18/D19).** A public page trusting it would
  show a streak that already broke, so the service recomputes on read, as the
  shell does.

Sections that are off are `null` and **their queries do not run** — the same
"never loaded" rule as D34's blind retry.

### One gate, one 404

Every entry point goes through one lookup whose WHERE clause is
`public_profile_enabled AND handle = ? AND not deleted`. A profile that is off,
unhandled or deleted is the same 404 as a handle that never existed, so the
page cannot be used to test whether an account exists.

### Not indexed

`/u/<handle>` is `noindex`. The owner chose to be reachable by a link; being
listed by search engines is a further exposure they were not asked about. The
share cards are the intended way to be found. Revisit only with an explicit
per-user "let search engines index me" choice.

### Share cards

`/u/<handle>/card/linkedin|x|whatsapp` — 1200×627, 1600×900, 1080×1080 — via
`next/og` on the Node runtime (it queries the database). Each number is one of
the owner's enabled sections; one that is off is absent, not zero. Cached an
hour, because the numbers move daily. The e2e spec reads each PNG's IHDR, so
"renders at all three sizes" is a measured fact rather than a declared one.

### Evidence

- 12 integration tests, including the privacy test with a positive control: a
  deliberate bio leak into the view made it fail. The format CHECK is proved by
  a direct write the service never makes (`23514`).
- `e2e/public-profile.spec.ts` captures every payload of the page as a
  signed-out visitor, with prefetches, and finds none of the code, approach,
  stuck note, bio or email — while finding the display name and topic, which is
  the control.
- `tests/security/routes.test.ts` now lists both routes as PUBLIC, each with
  its reason, as that file requires.
- Migration `0027_public_profile` is additive: one nullable column, four
  booleans with defaults, a partial unique index and a CHECK.

---

## D36 · F4.7b: a landing page that only says true things, and a deferred Sentry

**Date:** 2026-09-26 · **Status:** built. No migration.

### The rule, and the test that keeps it

The owner's constraint for this page: every claim true today — no invented
numbers, no features that do not exist (contests, referrals, coins), no
testimonials or user counts, real screenshots only. The ticket's own copy
could not meet it: its hero promised an "AI-assisted dashboard" and
"contests", and its sections included a pricing table. All three are cut.

`tests/public/landing-honesty.test.ts` reads the page's copy — string literals
and JSX text, comments stripped, because the header comment names the
forbidden topics in order to forbid them — and fails on any of them. Its
positive control earned its place on the first run: "Refer a friend" slipped
past the first referral pattern, and the pattern was widened.

### What changed on the page

- **The mock hero card is gone.** It showed a "24:18" timer and a "Live" pill:
  invented figures in the most prominent spot on the site. It is now a real
  screenshot of the dashboard.
- **Screenshots are the real app, of a SEEDED DEMO account**, captured from a
  local build (`scripts/demo-seed.ts`, local test database only). Every number
  in them is example data and each one says so beside it.
- **Only features with no flag are shown.** Revision modes, code execution and
  original problems are behind flags whose production values are stored as
  sensitive in Vercel and cannot be read from here, so the page cannot know
  they are on. The revision screenshot was recaptured with modes off, and the
  timeline was dropped — locally its runs come from the fake provider and read
  "(not executed)", which is not what the product shows.
- **FAQ**, each answer pointing at behaviour in the code: who can see your
  data, deleting history, where problems come from (worded to be true whether
  or not original problems are switched on), no paid plan, company tags.
- **Footer disclaimer** — the wording the product already shows beside
  company tags, extended to the platforms it links to.
- **JSON-LD** — `WebSite` and `WebApplication`, facts only. No
  `aggregateRating`, no `offers`: there are no reviews and nothing for sale.

### Sentry is now loaded by dynamic import, and deferred on public pages

Measured: the one blocking cost on the mobile landing page was
`@sentry/nextjs` in the browser — a 410 KiB chunk parsed before first paint on
every page, statically imported by `instrumentation-client.ts` **and** by both
error boundaries. Tree-shaking options were tried first and changed nothing
(the chunk's hash and size were identical), so they were reverted rather than
left in with a comment claiming a saving.

Now `lib/monitoring/sentry-client.ts` is the browser's only door to the SDK:

- **Inside the app** it starts loading at once, as before.
- **On `/` and `/u/*`** it waits for the browser to go idle. Owner's choice.
- **The error boundaries load it on demand**, so an error they catch before the
  SDK arrived is delayed, not dropped.

The trade, accepted by the owner: on a public page, an error in its first
moments is reported once the SDK arrives, and a router transition before then
is not traced. Verified structurally: after the change, neither chunk that
contains the SDK is referenced by the landing page's HTML.

### Lighthouse, stated as measured

**Production, mobile, PageSpeed Insights** (run by the owner on 2026-09-26,
against `quadrantcode.vercel.app` after this change deployed):

| Performance | Accessibility | Best practices | SEO | CLS | TBT   |
| ----------- | ------------- | -------------- | --- | --- | ----- |
| **95**      | **91**        | 100            | 92  | 0   | 40 ms |

So the ticket's "Lighthouse ≥ 95" is **met for performance and not met for
accessibility (91)**. SEO is 92. Both are lower than the local runs, which
scored 100 on each — the production page is served with its real headers,
deployment and third-party requests, so the two are not the same measurement.
The accessibility and SEO gaps are recorded here as open and have **not been
investigated**; no claim is made about their cause.

For comparison, local runs of the same build scored desktop performance 98–100
and mobile performance 70–92, a spread too wide on identical code to settle
anything, which is why the production number is the one recorded.

---

## D37 · F4.5's upsolve queue is derived, not stored

**Date:** 2026-09-26 · **Status:** built. No migration, no flag of its own.

### What was missing

F4.5's timed engine already existed (`server/services/assessments/`, see the
note in `CLAUDE.md` that two cut tickets "exist under another name"). Its one
genuinely missing criterion was the upsolve queue: "Unsolved problems land in
the upsolve queue automatically." It was the third of the four re-scoped
tickets (D34), built under the owner's instruction to finish what remains
without data or feature loss.

### Derived from rows that already exist

`getUpsolveQueue` reads finished attempts (`submitted` or `auto_submitted`),
their paper's questions, the marks each answer earned, and the solves that came
afterwards. There is no queue table:

- **Nothing has to "land".** A problem is in the queue the moment its attempt
  is finalised without marks for it — including when the expiry sweep
  auto-submits it, which is exactly the path a stored queue would most easily
  forget to write.
- **Nothing can drift.** There is no second copy to keep in step, so no
  migration and no backfill, and every attempt already in the database is
  covered on day one.

### The rules, each tested

- **Unsolved** = the answer earned no marks, **including a question never
  opened** (no answer row at all — the left join is the point). Each item says
  which: "attempted" or "not opened".
- **Cleared** only by solving it **after** the attempt — a solved sitting, or
  marks for it in a later assessment. A solve from before the mock does not
  count: the mock is the newer evidence. Positive control: making the rule
  ignore the solve's timing made that test fail.
- **One row per problem**, the most recent miss, so a problem missed in two
  mocks is one thing to do.
- A live attempt contributes nothing until time is up.

### Where it shows

On an attempt's own page once it has ended ("from this attempt"), and on
`/revision` ("Upsolve after assessments"). Both render nothing when empty, so
neither page changes for anyone who has not finished an assessment.

`FEATURE_MOCKS` is not consulted: an attempt can only exist if mocks were on
when it was taken, and hiding a user's own unfinished work because the flag
was later switched off would be the wrong default.

The test fixture for an assessment paper moved from `service.test.ts` to
`tests/helpers/assessment-fixture.ts`, shared by both files, rather than being
copied.

---

## D38 · F4.2: one honest track, declared in code, behind `FEATURE_TRACKS`

**Date:** 2026-09-26 · **Status:** built, flag off by default. No migration.

### What shipped, and what did not

The last of the four re-scoped tickets (D34). The ticket asks for four tracks.
**One ships — Fundamentals — and three do not**, for reasons that are not
effort:

- **FAANG-, Quant- and HFT-style were premium tracks.** Premium gating rests
  on F4.4's `hasEntitlement`, and F4.4 (billing) is cut. There is nothing to
  gate with and nothing to sell, and pretending otherwise would be the
  unverifiable claim the landing page just stopped making (D36).
- **HFT-style is built on five ORIGINAL problems** (Rolling Trade Volume, Order
  Book Matcher, …) authored through F4.1 and validated on Judge0. They do not
  exist, and a track of problems that do not exist is a promise, not a feature.
- **Fundamentals has 30 problems, not 40**: the external-link problems
  production actually publishes, read on 2026-09-26. The seven `demo-*` rows
  the walkthrough seed left in production's catalog are excluded; a test
  forbids any `demo-` slug in a track.

So the ticket's "all four tracks populated" criterion is **not met**, and is
recorded here rather than papered over.

### Declared in code, resolved against the catalog

`server/services/tracks/catalog.ts` names each section's problems by slug.
They are resolved at read time against published, non-premium, external-link
problems. That is why there is no track table:

- the catalog stays the one source of truth for what a problem is,
- track content is reviewed in pull requests like the rest of the code, and
- a slug that is not in the catalog is **dropped and counted** ("N problems are
  not in the catalog yet"), never rendered as a dead link.

### The criteria that are met, each tested

- **Time remaining changes when the user's own speed changes.** For each
  solved problem in the track, best ACTIVE time (F1.4) over the estimate gives a
  ratio; the mean per difficulty scales each unsolved problem's estimate, a
  difficulty with no solves borrows the overall ratio, and a user with no
  solves sees plain estimates labelled as such. The test changes one best time
  and watches the remaining minutes move from 20 to 80.
- **Prerequisites block out-of-order section entry.** A prerequisite is always
  an earlier section (tested), so one pass decides every lock; a locked section
  lists its problems without links. Positive control: ignoring prerequisites
  made that test fail.
- **The disclaimer renders on every track page** — `CompanyDisclaimer`, the
  product's existing wording.
- **Premium content in free users' payloads**: vacuous today, because nothing
  is premium. Stated rather than claimed.

### Behind a flag, and one thing the flag cannot promise

`FEATURE_TRACKS` is re-added and enforced: off, `/tracks` is a 404 and the
dashboard link is absent. **But a `FEATURE_TRACKS` variable already exists in
Vercel Production from before the 2026-09-16 flag cleanup**, stored as
sensitive, so its value cannot be read from here. If it is `true`, tracks are
visible the moment this deploys. That exposes nothing private — a track only
reads the catalog and the viewer's own progress — but it is a visibility
change the owner should confirm on `/admin/health`. The same caveat applies to
`FEATURE_REVISION_MODES` (D34).

## D39 · No Suspense boundary above `/problems/[slug]`: a framework bug drops server-action renders under it

**Date:** 2026-10-04 · **Status:** built. No migration, no dependency change.
Closes issue #26.

### The symptom

Clicking "Start solving" on a problem page sometimes did nothing visible. No
timer bar, no "Session started" notice, no error. A reload showed the timer.
In CI this surfaced as `session.spec`, `reflection.spec` and `timeline.spec`
failing or going flaky in a different combination on every run, 102 failures
across five runs on 2026-10-03, almost all of them a timer region or a notice
that never appeared.

### What it was not, and how that was shown

The first hypothesis, a click landing before hydration, was **wrong**. The
Playwright traces from the failed runs showed, for all 14 failures:

- the click produced a server-action POST, and it returned 200;
- 13 of the 14 response bodies held `ok: true` and the new layout, with the
  timer bar's props and the new session id (the fourteenth body was empty in
  the trace and is unverified);
- the browser console was empty, with no reload or refetch after the POST.

So the server did its part every time, and the browser rendered nothing. A fix
for hydration would have fixed nothing.

### The experiments

A throwaway branch (`diag/start-race-experiments`, never merged) ran one
dedicated spec on CI with retries off, 20 repetitions per condition. Each
attempt clicked "Start solving" and waited 10 s for the timer. E2: on every
failure the page was reloaded to see whether the server held the session.

| Round · CI run  | Condition                                                  | Timer shown | Timer missing | Shown after reload |
| --------------- | ---------------------------------------------------------- | ----------- | ------------- | ------------------ |
| 1 · 37153213896 | E1 default, click right after load                         | 13          | 7             | 7 / 7              |
| 1 · 37153213896 | E1 default, click after `networkidle`                      | 10          | 10            | 10 / 10            |
| 1 · 37153213896 | E3 prefetch disabled on shell links, immediate             | 9           | 11            | 11 / 11            |
| 1 · 37153213896 | E3 prefetch disabled, after `networkidle`                  | 11          | 9             | 9 / 9              |
| 2 · 37154285169 | **E4 `problems/loading.tsx` removed, immediate**           | **20**      | **0**         | —                  |
| 2 · 37154285169 | **E4 `problems/loading.tsx` removed, after `networkidle`** | **20**      | **0**         | —                  |
| 2 · 37154285169 | E5 `router.refresh()` once if the layout lags, immediate   | 12          | 8             | 8 / 8              |
| 2 · 37154285169 | E5 `router.refresh()` once, after `networkidle`            | 18          | 2             | 2 / 2              |

What this establishes:

1. **Prefetching and timing are not the cause.** E1 and E3 fail at the same
   rate, early click or late, prefetch on or off.
2. **The server is always right.** 56 of 56 failures showed the timer after a
   reload. The session existed, and only the client's render was missing.
3. **The Suspense boundary from `app/(app)/problems/loading.tsx` is the
   condition.** Without it: 40 of 40 shown, median 20 ms after the click,
   worst 31 ms.
4. **A refresh-once workaround is not reliable.** It fired 18 times and still
   left 10 of 40 attempts without a timer. The refresh re-renders the same
   boundary and hits the same bug.

No console error, `pageerror` or unexpected `requestfailed` appeared in any of
the 160 attempts.

### The upstream bug

Versions here: **Next.js 15.5.24**, app `react`/`react-dom` **19.2.8**. The
app router uses the React build that Next bundles.

- **https://github.com/vercel/next.js/issues/87529**: "Client UI doesn't
  update after revalidatePath with Suspense and short promise". It is
  production-only, the server and client both have the new data, and the DOM
  stays stale until an unrelated state change forces a commit. The reporter
  bisected it to `v15.4.2-canary.20`. A Next maintainer confirmed on
  2026-05-22 that it no longer reproduces on `next@16.2.6`, and closed it.
- **https://github.com/vercel/next.js/pull/82159**: the React upgrade in that
  canary, the only runtime change in the range.
- **https://github.com/facebook/react/pull/34031**: "[Fiber] Treat unwrapping
  React.lazy more like a use()", identified in the issue thread as the React
  change in that bump that touches the Fiber runtime. The thread describes it
  as rendered but not committed.

### The decision

**The problem detail and solve pages sit under no `loading.tsx` boundary.**
`app/(app)/problems/page.tsx` and its `loading.tsx` moved into a route group,
`app/(app)/problems/(catalog)/`. The catalog keeps its skeleton, URLs are
unchanged, and `/problems/[slug]` and `/problems/[slug]/solve` no longer
inherit the boundary.

This is a fix at our level, not a workaround around the symptom. The race
needs a boundary above the subtree that a server action re-renders. The pages
where sessions start and are worked on no longer have one. That removes the
condition E4 isolated for every action there (start, pause, stuck,
run-then-refresh, complete), although E4 measured only start. It is a
real-user fix as much as a test fix: anyone could hit it.

_Superseded on 2026-10-05: the dashboard case did fail later, and both
remaining `loading.tsx` files were removed. See "Update · 2026-10-05" below._

**`app/(app)/dashboard/loading.tsx` stays.** The audit found no server action
of the dashboard's own. The layout's timer-bar actions do re-render it, so the
regression spec measures them there: 10 pauses and 10 resumes on `/dashboard`
and the same on the catalog, **0 failures in 40 actions**, before the fix
(CI run 37155241675). The condition is not universal. #87529 ties it to a
short-lived promise under the boundary, and the evidence only implicates the
problem pages. If the dashboard or catalog cases ever fail, they get the same
treatment.

Rejected:

- **The refresh-once workaround (E5).** 25% of attempts still failed.
- **Upgrading to Next 16.2.x here.** It is the real fix for the framework bug,
  but it is a major upgrade with its own risk, tracked as a separate issue.
- **Disabling prefetch.** It had no effect (E3).

### What the user sees now while a problem page loads

Nothing in the page changes until the new page is ready, because there is no
boundary to show. Client navigation is a transition: the previous screen stays
in place, with no progress indicator, for as long as the server takes to
render the problem page. In the CI trace that was 37 ms. Production on Neon
was not measured.

What was lost was the catalog's table skeleton, which never had the shape of
a problem page anyway. A follow-up can give feedback without a Suspense
boundary: `useLinkStatus` (available in Next 15.5) on catalog and track links
to show a pending state on the clicked link. Not built here.

### How this is guarded, and when to revisit

- `e2e/session-commit.spec.ts` repeats each case 10 times with retries off and
  counts failures, so a single run misses a 45%-per-attempt bug with
  probability ~0.1%. Before the fix: **6 of 10** starts failed on the problem
  page (CI run 37155241675). After the fix, in three CI runs (37155989997, and
  37155969561 attempts 1 and 2): **0 of 10** every time. The whole browser
  suite went from 157 passed, 2 failed and 5 flaky to **164 passed, 0 failed,
  0 flaky**, 5 skipped (the five-language Vercel Queue + Sandbox release gate in
  `execution-queue.spec.ts`, which runs only with `RUN_VERCEL_SANDBOX_E2E=1`;
  corrected 2026-10-05, this first said "the storage suite", which is the unit
  suite's five skips), in all three runs. Session,
  reflection and timeline had no failures or retries. Unit: 1,557 passed,
  5 skipped.
- A fourth run (37156941037) failed in the dashboard case, in its **setup**,
  not in the Pause/Resume loop. The helper navigated away while the start
  action's POST was still in flight, which cancels it, so no session was ever
  created. The spec now waits for the action's response before navigating.
  The final verification runs are listed on PR #28.
- **Revisit after upgrading to Next ≥ 16.2:** put a `loading.tsx` back above
  `[slug]` on a branch and run `e2e/session-commit.spec.ts` with
  `--repeat-each=5`. If it stays at zero, the boundary can return. If it
  fails, this decision stands.

### Update · 2026-10-05: the dashboard too, so no boundary anywhere under `(app)`

**What happened.** The paragraph above kept `app/(app)/dashboard/loading.tsx`
on the evidence of 0 failures in 40 actions. Two days later the regression
spec caught it. In CI run **37223988230** (the push run of PR #36, which
touches neither the dashboard nor the timer bar), `PAUSE AND RESUME COMMIT,
EVERY TIME (dashboard)` failed with `stale timer bar on /dashboard: resume#1`:
after Resume, the bar did not show Pause within 5 s. That was 1 of the 20
actions in that run. The dashboard case had passed in about eight runs before
it (roughly 160 actions), so it is rare, but it is the same bug. A real user
pausing or resuming on the dashboard could see the bar not update until they
reload.

**Decision.** No `loading.tsx` may sit above any page that renders the timer
bar, which is every page under `(app)`, because the bar is in
`app/(app)/layout.tsx`. Removed:

- `app/(app)/dashboard/loading.tsx` (the stat-grid skeleton);
- `app/(app)/problems/(catalog)/loading.tsx` (the catalog's table skeleton).
  Its regression case has not failed, but the mechanism is the same, and the
  rule has to be about the boundary, not about which page has been unlucky so
  far.

The `(catalog)` route group stays; it is harmless and keeps the URL layout.

**Guarded twice:**

- `tests/app/no-loading-boundary.test.ts` fails if `app/loading.tsx` exists,
  if any `loading.tsx` exists under `app/(app)/`, or if a file there contains
  `<Suspense`. It has positive controls (the walk reaches the `(app)` pages,
  and the timer bar is really in that layout) and negative controls (each kind
  of boundary is detected; routes outside `(app)` are left alone).
- `e2e/session-commit.spec.ts` now runs Pause/Resume ×10 on four pages:
  dashboard, catalog, problem page and solve page, plus the ×10 start case.

**What the user sees.** Same as for the problem page above: navigating to the
dashboard or the catalog keeps the previous screen until the new one has
rendered, with no skeleton. Issue #30 (`useLinkStatus`) is the follow-up for
feedback on the clicked link without a boundary. `StatGridSkeleton` in
`components/ui/Skeleton.tsx` is now unused, and is kept for when the boundary
can return. The criterion "every list route has a skeleton state" in
`docs/acceptance-status.md` is marked as withdrawn, pointing here.

**Verified** in three CI runs on the change (PR #37: 37241848654, and
37241845313 attempts 1 and 2). Each had **179 passed, 0 failed, 0 flaky**,
5 skipped in the browser suite, including all six `session-commit` cases. Unit:
1,582 passed, 5 skipped. Locally, the guard test was shown to fail, naming the
file, when a throwaway `app/(app)/dashboard/loading.tsx` was added.

**Revisit** exactly as above, after Next ≥ 16.2 (#29): restore the boundaries
on a branch, relax `tests/app/no-loading-boundary.test.ts` in that same
branch, and run `e2e/session-commit.spec.ts --repeat-each=5`.
