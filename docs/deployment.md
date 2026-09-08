# Production deployment

This runbook targets Vercel plus managed PostgreSQL. Neon is the reference
because it supplies a pooled serverless URL and a direct migration URL, but any
PostgreSQL provider with those two connection modes is compatible.

## 1. Create infrastructure

1. Create separate production and preview databases. Do not point previews at
   production user data.
2. Put the pooled URL in `DATABASE_URL` and the direct URL in
   `DIRECT_DATABASE_URL`. `DATABASE_URL_UNPOOLED` remains supported for the
   Neon integration.
3. Enable provider backups and record the restore procedure and retention.
4. Create an Upstash Redis database in the same broad region as the app and
   copy its REST URL/token to Vercel.
5. Create a Sentry Next.js project, an S3-compatible avatar bucket, and a
   Judge0 deployment only for features that will be enabled.

The application pool is intentionally small (`max: 3`) and disables prepared
statements for transaction-pool compatibility. Migration commands always
prefer the direct URL.

## 2. Configure authentication

- Generate `AUTH_SECRET` with `npm exec auth secret`. It must be at least 32
  random characters and identical across instances in the same environment.
- GitHub OAuth callback:
  `https://<domain>/api/auth/callback/github`. Disable wildcard callback
  matching. Use separate OAuth apps for local/preview/production, or configure
  Auth.js's stable redirect proxy explicitly.
- In Resend, verify a dedicated sending subdomain, publish SPF and DKIM, then
  add DMARC. `EMAIL_FROM` must use that verified domain.
- Register the exact MSG91 OTP template before enabling `FEATURE_PHONE_OTP`.
  Leave the feature off until a real handset test succeeds.

At least one of GitHub or Resend must be configured. Unconfigured methods are
disabled in the UI and are not registered with Auth.js.

## 3. Configure Vercel

1. Import the Git repository into Vercel and set the production branch to
   `main`.
2. Add every variable from `.env.example` separately to Preview and Production.
   Never commit `.env`, paste secrets into an issue, or expose a secret with a
   `NEXT_PUBLIC_` prefix. The Sentry browser DSN is intentionally public; the
   Sentry auth token is not.
3. Set `NEXT_PUBLIC_APP_URL` to the final HTTPS origin for each stable
   environment and `NEXT_PUBLIC_SUPPORT_EMAIL` to a monitored mailbox.
4. Protect preview deployments containing real provider credentials.
5. Keep Vercel's Git integration enabled: pull requests get preview deployments
   and merging `main` creates production. Require both CI jobs in branch
   protection before merge.

`vercel.json` runs `npm run deploy:check` before `next build`. It blocks HTTP or
localhost origins, missing distributed rate limiting, missing authentication,
missing monitoring, or credentials required by an enabled feature.

## 4. Migrate safely

Migrations are reviewed SQL files under `server/db/migrations`. The production
workflow is manual and uses the protected GitHub `production` environment:

1. Take or confirm a fresh provider backup.
2. Test the forward migration and application build against the preview
   database.
3. Run **Production database migration** from GitHub Actions.
4. Deploy/merge only after the migration succeeds.

Prefer additive, backward-compatible migrations (new nullable column/table,
backfill, then constraint in a later release). For rollback, first roll back the
Vercel deployment. Reverse database SQL under `migrations/down` is a last resort:
review the exact file, take another backup, and test restoration before running
`npm run db:rollback`. A code rollback does not automatically reverse data.

### Import the native content library

After migrations 0020–0023 are applied, validate and import the checked-in
original content:

```powershell
npm run native:validate
npm run papers:validate
npm run native:import
```

The importer is transactional and idempotent: rerunning the same versions is a
no-op. It imports 100 problems and 20 pattern-based mock papers as
`needs_review`; it does not bypass editorial or real-provider validation.

Before publishing any problem, configure Judge0 and use the admin problem
review workflow to validate all five languages against every stored case. A
local `npm run native:validate-references` pass does not satisfy this production
gate.

## 5. Provider verification

- GitHub: sign in with a new account, an existing linked email, denial/cancel,
  and sign-out. Confirm the callback never leaves the configured origin.
- Resend: send to Gmail and another mailbox provider; verify SPF, DKIM and DMARC
  results, link expiry, one-time use, and sender reputation.
- MSG91: request, retry, wrong-code, expiry and lockout on a real device.
- Judge0: compare `/languages` with the app mapping; run accepted, compile,
  runtime, timeout, output-cap, network-disabled, and provider-outage cases.
  Then validate each native problem from its admin review page and confirm its
  validation timestamp/provider summary before publishing.
- Avatar storage: upload valid JPEG/PNG/WebP plus oversize and disguised files;
  verify public read and orphan cleanup.
- Sentry: trigger a controlled preview error, confirm environment/release tags
  and symbolicated source maps, then delete the test event if policy requires.

## 6. Health and rollback

- `/api/health/live` proves the process can answer and performs no dependency I/O.
- `/api/health/ready` requires Postgres and the production configuration for
  enabled features; it returns 503 when traffic should not be sent.
- `/api/health` remains the terse compatibility/dependency endpoint.
- `/admin/health` is the authenticated operational view.

After deployment, watch Vercel function errors, Postgres connection usage,
Upstash denials, email bounces/complaints, OTP failures, Judge0 latency and
Sentry error rate. Roll back the Vercel deployment first if the release is bad;
restore the database only when data/schema damage is confirmed.

## Background work

There is no deployed Redis/BullMQ worker in the trimmed architecture. Imports
and executions use in-process runners with durable Postgres job rows. Schedule
the existing sweep, retention, cleanup and rollup scripts with an authenticated
cron/operations runner before claiming automated recovery. Do not deploy the
placeholder worker as if it supplied retries—it does not.
