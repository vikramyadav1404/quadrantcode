# Launch checklist

## Accounts and configuration

- [ ] Final domain and DNS are active over HTTPS.
- [ ] Production and preview PostgreSQL databases are isolated.
- [ ] Backups are enabled and a restore drill has succeeded.
- [ ] All Production/Preview Vercel variables pass `npm run deploy:check`.
- [ ] GitHub callback is exact and wildcard matching is disabled.
- [ ] Resend SPF/DKIM pass and DMARC is published.
- [ ] Upstash rate limiting denies a controlled over-limit test.
- [ ] Sentry receives a symbolicated preview error and an alert reaches a person.
- [ ] Support mailbox is monitored.
- [ ] Optional phone, execution and avatar features stay off until their real
      provider tests pass.
- [ ] Migrations 0020–0024 are applied and `npm run native:import` reports
      exactly 100 problems and 20 papers.
- [ ] `sandbox/toolchain-lock.json` records verified immutable base, Node and
      VCR image digests; its SBOM and vulnerability scan are archived.
- [ ] Preview Sandbox contracts prove TLE, MLE, PID, output, disk, network,
      secret isolation, hidden-input isolation, per-case cleanup and final stop.
- [ ] Every published native problem has a current real-provider validation; no
      imported `needs_review` item was bulk-promoted.

## Release gate

- [ ] `npm ci`
- [ ] `npm run typecheck`
- [ ] `npm run lint`
- [ ] `npm run format:check`
- [ ] `npm run native:validate`
- [ ] `npm run papers:validate`
- [ ] `npm run native:validate-references`
- [ ] `npm run execution:image:verify`
- [ ] `npm run contrast`
- [ ] `npm test`
- [ ] `npm run build`
- [ ] `npm run test:e2e`
- [ ] `npm audit --omit=dev` has no unresolved high/critical runtime issue.
- [ ] Preview smoke test passes at desktop and mobile widths.
- [ ] Fresh backup exists immediately before production migration.
- [ ] Manual production migration workflow succeeds.

## Post-deploy

- [ ] `/api/health/live` returns 200 and `alive`.
- [ ] `/api/health/ready` returns 200 and `ready`.
- [ ] Home, login, GitHub, email link, onboarding, dashboard and logout work.
- [ ] Auth/session cookies are Secure and HTTP-only on the final domain.
- [ ] Security headers and canonical/OG/robots/sitemap output are present.
- [ ] Admin authorization, IDOR denial, upload caps, and rate limits were smoke-tested.
- [ ] Native Run/Submit, hidden-case redaction, company evidence labels and one
      timed mock paper passed manual QA from `docs/native-manual-qa.md`.
- [ ] Queue age, retry count, expired leases, cleanup-pending jobs and UTC-day
      admission count are visible and within their limits.
- [ ] Logs and Sentry contain no OTP, token, email body, or database URL.
- [ ] Rollback owner and rollback deployment are identified.
