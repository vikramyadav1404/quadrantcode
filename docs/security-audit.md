# Security audit — F4.8

_Run 2026-08-29 against `main` at 79 commits. Every claim below was executed,
not reasoned about; where something could not be executed it says so._

This is an audit, not a feature. It has three sections: **findings** (fixed),
**accepted risks** (not fixed, with the reason), and **could not be verified**
(blocked, with what would unblock it).

---

## Findings, and what was done about them

### 1 · Two protected pages were missing from the middleware — FIXED

`/analytics` (added by F1.6) and `/mistakes` (added by F3.5) were never added to
`middleware.ts`'s `PROTECTED_PREFIXES`.

**Exposure:** none in terms of data. Both pages call `requireCurrentUser()`,
which throws before any query runs. But an anonymous visitor got a 500 error
page instead of a redirect to login, and the first layer of defence was absent
on two routes.

**Severity:** low.

**Fix:** both added, and `tests/security/routes.test.ts` now walks the
filesystem for every `route.ts` and `page.tsx` and fails on any route nobody has
classified. The next omission fails a test rather than waiting for an audit.

### 2 · The secret-scan canary was vacuous — FIXED

F0.1 recorded that its gitleaks canary "passed" against AWS's documentation key,
which gitleaks allowlists by default. Re-running that canary today produced the
same non-result: **no leaks found**, from a file containing two obvious secrets.

**Fix:** re-verified with a freshly generated `sk_live_` token, which the config
does catch. `.gitleaksignore` carries a note telling anyone who changes it to
re-verify the same way, with a secret that is not on somebody's known-example
list.

### 3 · One finding in the full-history scan — REVIEWED, not a leak

`gitleaks git . --log-opts=--all` over 79 commits reported one:

```
server/services/execution/provider.ts:150   generic-api-key
    ...(env.JUDGE0_API_KEY ? { apiKey: env.JUDGE0_API_KEY } : {})
```

The rule matched the identifier beside `apiKey:` on entropy. There is no secret
VALUE — the line reads from the environment, and this repository has never
contained a Judge0 key because there has never been a Judge0 instance.

**Fix:** a fingerprint entry in `.gitleaksignore`, pinned to one commit, one
file, one rule and one line. Change that line to hold a real key and the
fingerprint changes and the scan fires again. Disabling the rule, or
allowlisting the file, would have silenced every future finding in the place
most likely to grow one.

**After the fix: 79 commits scanned, no leaks found.**

---

## Accepted risks

### A · `drizzle-orm` SQL injection advisory (HIGH) — not exploitable here

[GHSA-gpj5-g38j-94v9](https://github.com/advisories/GHSA-gpj5-g38j-94v9) —
"SQL injection via improperly escaped SQL identifiers", fixed in 0.45.2. This
project is on 0.44.2 and the upgrade is semver-major.

**Assessed rather than assumed.** The advisory is about IDENTIFIERS — table and
column names — being improperly escaped, which is exploitable when an identifier
comes from user input. In this codebase:

- Every `sql.raw` call was enumerated. There are three, all in schema CHECK
  constraints, all passing compile-time constants (`MAX_SOURCE_BYTES`,
  `MAX_STDIN_BYTES`, `MAX_SNAPSHOT_BYTES`).
- No column or table is ever selected from user input. There is no sortable
  column parameter, no dynamic `table[key]`, no user-supplied ordering.
- Every user value reaches the database through drizzle's parameterisation.

**Accepted because** a major version bump of the ORM at the end of the build is
a larger risk than the one it removes, and the exposure is nil. **Revisit the
moment any user-controlled value becomes an identifier** — a sortable table
column being the likely first one.

### B · `dompurify` advisories under Monaco (4 × MODERATE) — bounded

Four advisories, no non-breaking fix. Carried since F3.1, which recorded them
and handed them here.

**Exposure:** `dompurify` is reached only through Monaco's own rendering. **No
execution output and no user code passes through it** — `RunOutput.tsx` and
`Timeline.tsx` render every untrusted byte as a React text node, which
`tests/execution/rendering.test.ts` enforces by grep and `e2e/execution.spec.ts`
proves in Chromium with a positive control.

**Accepted because** Monaco is in the locked stack and the alternative is
removing the editor. Revisit when a non-breaking fix ships.

### C · `esbuild` dev-server advisory (MODERATE) — dev only

Reached through `drizzle-kit`. The advisory is about the esbuild DEV SERVER
accepting cross-origin requests. Nothing runs that server; `drizzle-kit` is used
for migration generation on a developer machine.

**Accepted because** it is not in any deployed path. The suggested fix is a
downgrade of `drizzle-kit` to 0.18.1, which is older than the migrations in this
repository.

### D · The audit log can be erased with TRUNCATE — needs a database role

`audit_logs` refuses UPDATE and DELETE by trigger, with no purge escape hatch —
stricter than `session_events` deliberately, since it exists so that people with
power over other people's data cannot erase what they did.

**But `TRUNCATE` does not fire row-level triggers.** Anyone with schema rights
can wipe the table, and the down migration for 0019 can drop it.

**Accepted for now because** closing it needs a least-privilege application role
separate from the migration role, which is a deployment decision and there is no
deployment. Handed forward explicitly: this is the single highest-value
infrastructure change when this project is deployed.

### E · Rate limiting is per-process without Redis

`server/services/auth/ratelimit.ts` is in-memory. On serverless, two invocations
each count their own requests and neither limits anything.

**Accepted because** production **refuses to start** without Redis rather than
degrading silently — the check is in `server/env.ts`. The risk is bounded to
development.

---

## Could not be verified

### A restore was never performed — BLOCKED

The criterion is "a restore was actually performed and verified — not merely
configured". **There are no backups.** There is no deployed database to back up:
the only Postgres this project has ever run against is the embedded test
instance, which is recreated from migrations on every run.

This is not a configuration gap that could be closed by writing something. It
needs a deployment. **Recorded as BLOCKED, not as done.**

### The load test is service-layer, not HTTP

`npm run loadtest` drives the two hottest read paths with 100 concurrent callers
against a real database:

| Path                | p50    | p95    | p99    | failures |
| ------------------- | ------ | ------ | ------ | -------- |
| Problem catalog     | 139 ms | 146 ms | 146 ms | 0        |
| Analytics dashboard | 115 ms | 146 ms | 149 ms | 0        |

**Dataset: 2 problems, 0 sessions.** That is reported by the script itself,
because latency without a denominator is a number that looks like a measurement.

No React rendering, no serialisation, no network, no cold starts, no platform
concurrency limits. **These are a floor**: production cannot be faster, and will
be slower by an amount this cannot measure. A real load test needs a deployed
instance.

### Razorpay webhook signature verification — nothing to verify

F4.4 is cut. There are no webhooks. The alert condition for a failed signature
exists and is tested (`tests/observability/alerts.test.ts`), so the wiring is
ready; there is nothing behind it.

---

## What was verified, and how

| Area               | Check                                                                                                                    | Result                                               |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------- |
| Route coverage     | Filesystem walk; every route classified public or protected with a reason                                                | **Pass** — 0 unclassified                            |
| Middleware         | Its prefix list compared against the routes that exist                                                                   | **Pass** after finding 1                             |
| IDOR               | Session, snapshot, execution, stuck point, import job — each read as a signed-in stranger, over real HTTP                | **Pass** — 404 for each                              |
| IDOR oracle        | Another user's id vs a nonexistent id: identical status AND identical body                                               | **Pass**                                             |
| Secrets            | `gitleaks git . --log-opts=--all`, 79 commits                                                                            | **Pass** after findings 2 and 3                      |
| Cookies            | `httpOnly`, `sameSite: lax`, `secure` in production                                                                      | **Pass** — `server/services/auth/config.ts`          |
| Output rendering   | User code and program output rendered as text nodes; no markup sink under `components/editor/` or `components/timeline/` | **Pass** — grep with controls, plus a Chromium proof |
| PII in logs        | Real log output grepped for an email and a phone                                                                         | **Pass** — with a control on both sides              |
| Audit immutability | UPDATE and DELETE at the database, and that the event log's purge flag does not unlock it                                | **Pass**                                             |
| Zod at boundaries  | Every API route and server action parses its input                                                                       | **Pass** — C7                                        |

### The IDOR test's own bug, worth recording

The first version used Playwright's bare `request` fixture, which is a separate
context with **no cookies**. Every assertion passed — with 401, not 404. An
anonymous rejection proves nothing about whether a signed-in stranger can read
somebody else's row, and the test would have shipped green while checking the
wrong thing.

`page.request` carries the session. This is the same class of error as F0.3's
"gets 403" asserted on a thrown error type, and it is the third time this
project has been caught by a test that passed for the wrong reason.
