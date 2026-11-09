# Launch checklist

## Accounts and configuration

- [x] Final domain and DNS are active over HTTPS. _(quadrantcode.vikramyadav.me,
      HSTS served — checked 2026-11-09)_
- [x] Production and preview PostgreSQL databases are isolated. _(checked
      2026-11-09: `DATABASE_URL`, `DATABASE_URL_UNPOOLED` and `DIRECT_DATABASE_URL`
      each have separate Preview and Production entries in Vercel; the shared
      entry D30 left open was split on 2026-10-05.)_
- [x] Backups are enabled and a restore drill has succeeded. _(see
      `docs/restore-drill.md`, performed 2026-09-18)_
- [x] All Production/Preview Vercel variables pass `npm run deploy:check`.
      _(2026-11-09: `vercel.json` runs it before every build. The Production
      deploy of `3ac8260` and the Preview builds of PRs #61–#65 all reached
      Ready, so both environments passed it.)_
- [ ] GitHub callback is exact and wildcard matching is disabled.
- [ ] Resend SPF/DKIM pass and DMARC is published. _(2026-11-09: not set up —
      no Resend records exist on the domain. Sign-in mail goes through Gmail SMTP
      instead (#64, `GMAIL_USER` + `GMAIL_APP_PASSWORD`, Production only), which
      needs no DNS. This item applies again only if Resend is turned on.)_
- [x] Upstash rate limiting denies a controlled over-limit test. _(2026-11-09:
      first run **failed** — every request returned 500 because the configured
      Upstash host no longer resolved in DNS. A new free database in
      `ap-southeast-1` was created and both variables were replaced. Re-run: 22
      signed-in GETs to `/api/ingest/export` returned 200 × 20, then 429 × 2 —
      exactly `exportPerUser` (20/hour).)_
- [ ] Sentry receives a symbolicated preview error and an alert reaches a person.
      _(2026-11-09: two blockers found. (1) The Production build log of `2b2c598`
      says `[@sentry/nextjs] Warning: No auth token provided`, so no source maps
      were uploaded: `SENTRY_AUTH_TOKEN` exists in Vercel but is empty. (2) The
      CSP allowed only `*.ingest.sentry.io`, and the browser DSN is
      `o….ingest.us.sentry.io`, so browser events were refused — fixed on branch
      `auto-pause-hidden-tab` (`lib/security/connect-src.ts`). No alert rule
      exists yet.)_
- [ ] Support mailbox is monitored.
- [x] Optional phone, execution and avatar features stay off until their real
      provider tests pass. _(2026-11-09: execution is on and passed — Judge0
      reference validation for 10 problems × 5 languages, and a native Submit
      7/7. Phone is off: no `FEATURE_PHONE_OTP` in Vercel. Avatar is off:
      `/api/health/ready` reports avatar storage unavailable — the five `S3_*`
      variables exist in Vercel but are empty. Turning it on also needs the
      bucket's CORS to allow `PUT` from the site, and the CSP now admits the
      `S3_ENDPOINT` origin at build time.)_
- [ ] Migrations 0020–0024 are applied and `npm run native:import` reports
      exactly 100 problems and 20 papers. _(Obsolete as worded: D27 retired the
      generated 100-problem library and the 20 papers. The live native library
      is 26 problems; `npm run native:validate` checks it.)_
- [ ] `sandbox/toolchain-lock.json` records verified immutable base, Node and
      VCR image digests; its SBOM and vulnerability scan are archived. _(Not
      applicable while `EXECUTION_BACKEND=judge0`; applies if Vercel Sandbox is
      turned on.)_
- [ ] Preview Sandbox contracts prove TLE, MLE, PID, output, disk, network,
      secret isolation, hidden-input isolation, per-case cleanup and final stop.
      _(Not applicable while `EXECUTION_BACKEND=judge0`.)_
- [x] Every published native problem has a current real-provider validation; no
      imported `needs_review` item was bulk-promoted. _(2026-11-09: the 10 batch-02
      problems were validated one at a time on Judge0 — 5 languages × every test
      — then published individually. The 16 batch-01 problems were already
      published through the same gate. All 26 native problems are `published`.)_

## Release gate

- [x] `npm ci` _(CI #268 on `main`, `3ac8260`, 2026-11-09)_
- [x] `npm run typecheck` _(CI #268 on `main`, `3ac8260`, 2026-11-09)_
- [x] `npm run lint` _(CI #268 on `main`, `3ac8260`, 2026-11-09)_
- [x] `npm run format:check` _(CI #268 on `main`, `3ac8260`, 2026-11-09)_
- [x] `npm run native:validate` _(2026-11-09: 26 problems, exit 0)_
- [x] `npm run papers:validate` _(2026-11-09: 0 active papers — papers retired)_
- [ ] `npm run native:validate-references`
- [ ] `npm run execution:image:verify`
- [x] `npm run contrast` _(2026-11-09: all pairs pass)_
- [x] `npm test` _(CI #268 on `main`, `3ac8260`, 2026-11-09)_
- [x] `npm run build` _(CI #268 on `main`, `3ac8260`, 2026-11-09)_
- [x] `npm run test:e2e` _(CI #268 on `main`, `3ac8260`, 2026-11-09)_
- [x] `npm audit --omit=dev` has no unresolved high/critical runtime issue.
      _(2026-11-09, after #62: 0 critical, 0 high; 6 moderate, all build-time
      `glob`/`minimatch`.)_
- [ ] Preview smoke test passes at desktop and mobile widths.
- [ ] Fresh backup exists immediately before production migration.
- [ ] Manual production migration workflow succeeds.

## Post-deploy

- [x] `/api/health/live` returns 200 and `alive`. _(checked 2026-11-09)_
- [x] `/api/health/ready` returns 200 and `ready`. _(checked 2026-11-09: postgres
      and configuration up; execution and monitoring configured; avatar storage
      unavailable)_
- [ ] Home, login, GitHub, email link, onboarding, dashboard and logout work.
      _(2026-11-09, partial: home and dashboard load; a Gmail sign-in link was
      requested for a real inbox, delivered, and signed in. GitHub sign-in is the
      admin's daily path. Onboarding and logout were not exercised.)_
- [x] Auth/session cookies are Secure and HTTP-only on the final domain.
      _(2026-11-09: `__Host-authjs.csrf-token` and `__Secure-authjs.callback-url`
      are `HttpOnly; Secure; SameSite=Lax`; the session cookie is set `httpOnly`
      and `secure` in production by `server/services/auth/config.ts`.)_
- [x] Security headers and canonical/OG/robots/sitemap output are present.
      _(checked 2026-11-09: CSP, HSTS, X-Frame-Options, nosniff, Referrer-Policy,
      Permissions-Policy, COOP; canonical + og:title/og:image; robots.txt and
      sitemap.xml return 200)_
- [ ] Admin authorization, IDOR denial, upload caps, and rate limits were smoke-tested.
      _(2026-11-09, partial: signed out, `/admin/**` redirects to `/login` and
      `/api/ingest/export` returns 401. Non-admin 403 and IDOR need a second
      account. Rate limits now return 429 — see the Upstash item. Upload caps not
      exercised: avatar storage is unavailable.)_
- [ ] Native Run/Submit, hidden-case redaction, company evidence labels and one
      timed mock paper passed manual QA from `docs/native-manual-qa.md`.
      _(2026-11-09, partial: Harbour Lot Echo in C++ — Run accepted 2/2, Submit
      accepted 7/7, hidden cases show the verdict only. Company evidence labels
      not checked; no mock paper exists to time — papers are retired.)_
- [ ] Queue age, retry count, expired leases, cleanup-pending jobs and UTC-day
      admission count are visible and within their limits.
- [ ] Logs and Sentry contain no OTP, token, email body, or database URL.
      _(2026-11-09: **failed.** A mis-pasted `UPSTASH_REDIS_REST_TOKEN` made
      `Headers.append` throw, and its error message — which quotes the header
      value — put the Upstash token in Vercel runtime logs. Later that day the
      Upstash credentials were reset and the new token replaced in Vercel; the
      over-limit test passed again (200 × 20, then 429), so the logged value is
      dead. Sentry was not inspected, so this stays open.)_
- [x] Rollback owner and rollback deployment are identified. _(Owner: Vikram
      Yadav, sole maintainer. Method: Vercel → Deployments → the previous
      Production deployment → Instant Rollback. A rollback restores code only;
      database migrations are not reversed by it.)_
