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

## D2 · The one `any` cast in the Auth.js adapter

**Status:** active · **File:** `server/services/auth/adapter.ts`

`@auth/drizzle-adapter`'s `DefaultPostgresUsersTable` type requires `id`, `name`,
`email`, `emailVerified` and `image`. F0.2 fixes the `users` shape, and
`display_name` / `avatar_url` live on `user_profiles`.

Two of the three requirements were solved by **column mapping**, not reshaping:
`emailVerified: timestamp('email_verified_at')` gives the library its property
name while the SQL column stays as specified. Regenerating the migration after
that rename produced **zero** change to `users`.

`name` and `image` have nothing to map to. The cast encodes exactly one
assumption:

> The adapter's _runtime_ never reads `users.name` or `users.image`.

That holds because `createUser` does `.insert(usersTable).values(data)` and
Drizzle silently drops keys that are not columns. It is **asserted, not
assumed** — `tests/auth/adapter.test.ts` creates a user through the real adapter
against a real database and separately asserts the columns do not exist. If a
future version starts depending on them, that test fails.

### Rejected alternative

Adding nullable `name` / `image` columns to `users`. Rejected because they would
duplicate `user_profiles.display_name` / `.avatar_url` with no owner and no
update path — two dead columns that later readers would have to reason about
forever, versus one cast with a test behind it.

---

## D3 · The worker does not run under `--conditions=react-server`

**Status:** active · superseded an earlier decision

`server-only` throws unless the `react-server` export condition is set, which
Next's server bundle sets and plain Node does not. The worker imported
`@/server/db`, which carries that guard, so it crashed at boot.

The first fix set `--conditions=react-server` on the worker script. That was
wrong: it silenced the guard process-wide and made the worker claim to be an RSC
environment it is not.

The layering fix instead:

| Module                | Guard                            | Imported by                            |
| --------------------- | -------------------------------- | -------------------------------------- |
| `server/db/client.ts` | none                             | worker, jobs, and `server/db/index.ts` |
| `server/db/index.ts`  | `import 'server-only'`           | application code                       |
| `lib/env.ts`          | none needed — public values only | anywhere, including the browser        |
| `server/env.ts`       | runtime `typeof window` check    | server code and the worker             |

`server/db/client.ts` has no build-time guard, so ESLint is the only thing
protecting it. `no-restricted-imports` is therefore **deny-by-default** across
all files with server paths exempted, and
`tests/boundary/server-boundary.test.ts` asserts the rule fires on that exact
deep path — plus that no npm script re-introduces the condition flag.

---

## D4 · Secret scanning runs the gitleaks binary, not the action

**Status:** active · **File:** `.github/workflows/ci.yml`

`gitleaks/gitleaks-action@v2` derives a commit range of `<before>^..<after>` on
push. On the **first** push `<before>` is the root commit, so `<root>^` is an
unknown revision: gitleaks aborted, scanned 0 bytes, and logged _"no leaks found
in partial scan"_ while failing the job.

A scan that can report "no leaks" without having read anything is worse than no
scan. CI now downloads a pinned binary and runs
`gitleaks git . --log-opts="--all"` — the whole history, every run, identical to
the local command.

Verified before trusting the result: gitleaks was run against a canary secret
and correctly flagged it. The AWS key from the official documentation is
allowlisted by gitleaks' own default rules and makes a **useless** canary — the
first canary attempt silently "passed".
