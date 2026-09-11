# Credentials plan

Every external value Quadrantcode needs, what it unlocks, and what it blocks
while it is missing. Compiled from the code and `docs/acceptance-status.md`, with
file references; nothing here is inferred from a provider's marketing.

**Secrets go into provider and Vercel dashboards only.** Never into chat, never
into a commit. `.env` and `.env.local` are gitignored and must stay that way.

---

## Read this before planning a demo

"Demo-critical" below means the three things a demo needs: a live URL, GitHub
login, and one working code-execution path.

**That set is not sufficient to deploy.** `vercel.json` runs
`npm run deploy:check` _before_ `next build`, and
[`scripts/check-deployment-env.ts`](../scripts/check-deployment-env.ts) refuses
the build outright unless Upstash, both Sentry DSNs, and a support email are
also present. They are conceptually hardening; in practice the build will not
start without them. They are marked **build-gate** in the table.

Minimum set to get a deployment to build and serve a GitHub login:

```
DATABASE_URL  DIRECT_DATABASE_URL  NEXT_PUBLIC_APP_URL  AUTH_SECRET
GITHUB_ID  GITHUB_SECRET
UPSTASH_REDIS_REST_URL  UPSTASH_REDIS_REST_TOKEN
SENTRY_DSN  NEXT_PUBLIC_SENTRY_DSN  NEXT_PUBLIC_SUPPORT_EMAIL
```

Execution is additional, and is the one genuinely hard piece — see
[Execution needs a decision](#execution-needs-a-decision).

---

## Self-generated secrets

These two are not obtained from anyone. Generate them yourself; a weak value is
a real vulnerability, not a formality.

| Var           | Minimum           | Generate with          | Enforced at                                              |
| ------------- | ----------------- | ---------------------- | -------------------------------------------------------- |
| `AUTH_SECRET` | 32 chars          | `npm exec auth secret` | boot — `server/env.ts`                                   |
| `CRON_SECRET` | 32 chars, trimmed | `npm exec auth secret` | boot — `server/env.ts`, and `check-deployment-env.ts:37` |

`AUTH_SECRET` must be **identical across every instance of one environment** and
**different between environments**. Rotating it invalidates every live session.

`CRON_SECRET` is the entire credential for
`/api/cron/executions/reconcile` — there is no session and no second factor
behind it. It is trimmed before use, a whitespace-only value counts as unset,
and anything under 32 characters fails at boot rather than silently disabling
the reconciler.

> Until this branch, `check-deployment-env.ts` demanded 32 characters but
> `server/env.ts` accepted any non-empty string, so a short secret passed boot
> and only failed at deploy time. Both now agree.

---

## The table

Free-tier notes were true when written and are the thing most likely to go
stale here — confirm on the provider's pricing page before committing to one.

| Env var                                                              | Provider                           | Needed for                                                                                                                          | Demo-critical         | How to obtain                                             | Free tier                        | Self-generated | Blocks                                                                                                                 |
| -------------------------------------------------------------------- | ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | --------------------- | --------------------------------------------------------- | -------------------------------- | -------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                                                       | Neon / any managed Postgres        | Pooled app connection; `server/db/client.ts` (`max: 3`, prepared statements off for transaction pooling)                            | **yes**               | Create DB, copy pooled URL                                | yes                              | no             | Everything. Without it nothing boots                                                                                   |
| `DIRECT_DATABASE_URL`                                                | same                               | Migrations, which cannot run over a transaction pooler; `docs/deployment.md` §1                                                     | **yes**               | Same DB, direct (non-pooled) URL                          | yes                              | no             | Migrations; F4.8 #5 restore drill                                                                                      |
| `DATABASE_URL_UNPOOLED`                                              | Neon                               | Alias kept for the Neon integration                                                                                                 | no                    | Auto-set by the Neon integration                          | yes                              | no             | Nothing; `DIRECT_DATABASE_URL` supersedes                                                                              |
| `NEXT_PUBLIC_APP_URL`                                                | your domain                        | Canonical URLs, cookies, OAuth callback, email links. Must be HTTPS and non-localhost                                               | **yes**               | Register a domain, point DNS at Vercel                    | domain costs money               | no             | Build gate; cookie/callback correctness                                                                                |
| `AUTH_SECRET`                                                        | —                                  | Auth.js session + OTP HMAC                                                                                                          | **yes**               | `npm exec auth secret`                                    | n/a                              | **yes**        | All authentication                                                                                                     |
| `GITHUB_ID` / `GITHUB_SECRET`                                        | GitHub                             | GitHub sign-in. Callback `https://<domain>/api/auth/callback/github`, wildcard matching off                                         | **yes**               | GitHub → Settings → Developer settings → OAuth Apps       | yes                              | no             | GitHub login. One of this **or** Resend is required by the build gate                                                  |
| `UPSTASH_REDIS_REST_URL` / `_TOKEN`                                  | Upstash                            | Distributed rate limiting. In production the in-memory limiter is refused — it would not limit anything across serverless instances | **build-gate**        | Upstash console → create Redis → REST credentials         | yes                              | no             | **The build.** Also the launch-checklist over-limit test                                                               |
| `SENTRY_DSN` / `NEXT_PUBLIC_SENTRY_DSN`                              | Sentry                             | Error monitoring, both server and browser                                                                                           | **build-gate**        | Sentry → create a Next.js project                         | yes                              | no             | **The build.** F4.6 criterion: no DSN means errors go to stdout only                                                   |
| `NEXT_PUBLIC_SUPPORT_EMAIL`                                          | your mailbox                       | `/contact`, `/privacy`, `/terms`                                                                                                    | **build-gate**        | Any monitored mailbox                                     | yes                              | no             | **The build.** Legal/contact surfaces                                                                                  |
| `SENTRY_ORG` / `SENTRY_PROJECT` / `SENTRY_AUTH_TOKEN`                | Sentry                             | Source-map upload, so production stack traces are readable                                                                          | no                    | Sentry → org/project slugs; token with `project:releases` | yes                              | no             | Symbolicated traces and release tagging                                                                                |
| `SENTRY_ENVIRONMENT`                                                 | Sentry                             | Tagging preview vs production                                                                                                       | no                    | Free text                                                 | n/a                              | no             | Nothing                                                                                                                |
| `EXECUTION_BACKEND`                                                  | —                                  | `vercel_sandbox` \| `judge0` \| `fake`. Required while `FEATURE_EXECUTION=true`; `fake` is refused in production                    | **yes**               | Pick one; see below                                       | n/a                              | no             | All execution                                                                                                          |
| `EXECUTION_SANDBOX_IMAGE`                                            | Vercel Container Registry          | The pinned image, `…@sha256:<64 hex>`. A mutable tag is refused at boot (`server/env.ts`)                                           | **yes**, if sandbox   | Build and push to VCR                                     | paid plan likely                 | no             | Sandbox execution; the 4 `execution:image:verify` issues                                                               |
| `CRON_SECRET`                                                        | —                                  | The reconciler's only credential                                                                                                    | **yes**, if execution | `npm exec auth secret`                                    | n/a                              | **yes**        | Undispatched-row recovery, lease reclamation, sandbox cleanup                                                          |
| `JUDGE0_URL` / `JUDGE0_API_KEY`                                      | Judge0 (self-host or RapidAPI)     | The alternative execution backend, explicit selection only — never automatic failover                                               | **yes**, if judge0    | Self-host, or RapidAPI subscription                       | self-host free; RapidAPI limited | no             | Native-platform publish gate: content stays `needs_review` until every language/case validates through a real provider |
| `RESEND_API_KEY` / `EMAIL_FROM`                                      | Resend                             | Magic-link delivery. Needs a verified sending subdomain with SPF + DKIM, then DMARC                                                 | no                    | Resend → verify domain → API key                          | yes, limited                     | no             | F0.3 magic-link delivery. Everything after the click is already covered by `e2e/auth-flow.spec.ts`                     |
| `MSG91_AUTH_KEY` / `MSG91_TEMPLATE_ID`                               | MSG91                              | Phone OTP. Required while `FEATURE_PHONE_OTP=true`                                                                                  | no                    | MSG91 → register OTP template                             | no                               | no             | Phone sign-in only, a cut-adjacent feature                                                                             |
| `S3_*` (5 vars)                                                      | Cloudflare R2 or any S3-compatible | Avatar upload, presign, orphan cleanup                                                                                              | no                    | R2 → bucket + API token + public base URL                 | yes                              | no             | The 5 skipped `STORAGE_INTEGRATION=1` live-bucket assertions                                                           |
| `AUTH_URL` / `AUTH_TRUST_HOST`                                       | —                                  | Only when Auth.js cannot infer its origin behind a proxy                                                                            | no                    | Set to the final origin                                   | n/a                              | no             | Nothing, normally                                                                                                      |
| `TRUST_PROXY`                                                        | —                                  | Whether `clientIp` may trust forwarded headers                                                                                      | no                    | Set on a trusted proxy only                               | n/a                              | no             | Rate-limit accuracy if wrong                                                                                           |
| `ALLOW_IN_MEMORY_RATE_LIMIT` / `ALLOW_CONSOLE_OTP`                   | —                                  | Escape hatches for the local production-build harness. **Never set in a deployment**                                                | no                    | —                                                         | n/a                              | n/a            | Nothing. Setting them in production is the hazard                                                                      |
| `REDIS_URL`, `TELEGRAM_BOT_TOKEN`, `RAZORPAY_*`, `ANTHROPIC_API_KEY` | various                            | **Cut features** — F2.3/F2.4 queue and notifications, F4.4 billing, F3.4 AI                                                         | no                    | —                                                         | —                                | no             | Nothing. Their presence in `.env.example` does not mean the feature exists                                             |

---

## Execution needs a decision

`FEATURE_EXECUTION` is false and both backends need something you do not have
yet. This is the only genuinely blocking choice on the list.

**Vercel Sandbox** is the designed path (D26): one ephemeral network-denied
microVM per submission. It needs a custom image built for `linux/amd64`, pushed
to Vercel Container Registry, and pinned by digest — VCR will not serve an image
to Sandbox until it has an optimized `linux/amd64` build, and reports
`Unoptimized` otherwise.¹ That requires Docker (not installed on this machine), a
Vercel account with VCR, and the preview security contracts in
`docs/launch-checklist.md`.

**Judge0** is the shorter path to a demo: self-host it, set `JUDGE0_URL`, and
select it explicitly with `EXECUTION_BACKEND=judge0`. It never becomes an
automatic fallback from Sandbox. Note that `EXECUTION_LIMITS` is what is _sent_
— whether it is enforced depends on how the instance was deployed (**D24**), so
a self-hosted Judge0 is not a sandbox unless you make it one.

Either way, publishing native content requires validating all five languages
against every stored case through the configured provider;
`npm run native:validate-references` passing locally does not satisfy that gate.

¹ https://vercel.com/docs/sandbox/concepts/images — "VCR only serves an image to
Sandbox once it has prepared an optimized `linux/amd64` build."

---

## Documentation drift check

**In `.env.example` but not in `server/env.ts`:** the 15 `FEATURE_*` flags,
`NODE_ENV`, `NEXT_PUBLIC_*`, `TEST_DATABASE_URL`, `STORAGE_INTEGRATION`. Not a
gap — flags are read through `lib/flags.ts` (`FEATURE_FLAGS`), and the rest are
build-, test- or client-side values outside the server schema.

**In code but not in `.env.example`:** nine, none of them an operator credential.

| Var                                                              | Why it is absent                                                     |
| ---------------------------------------------------------------- | -------------------------------------------------------------------- |
| `VERCEL`, `VERCEL_ENV`, `NEXT_PUBLIC_VERCEL_ENV`, `NEXT_RUNTIME` | Injected by the platform; you never set them                         |
| `TRACELOOP_ROLE`                                                 | The app sets it itself (`worker/index.ts:23`)                        |
| `E2E_EMAIL_CAPTURE`                                              | Test harness; `check-deployment-env.ts:9` refuses it in a deployment |
| `BASE_URL`, `COOKIE_NAME`                                        | `scripts/verify-admin-403.ts`, local only, both defaulted            |
| `DEMO_BASE_URL`                                                  | `scripts/demo-walkthrough.ts`, local only, defaulted                 |

No operator-facing variable is missing from `.env.example`.
