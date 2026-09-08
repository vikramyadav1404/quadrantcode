# Quadrantcode status

_Updated 1 September 2026 after the native-platform completion pass._

## Current outcome

The existing Next.js application has been retained and hardened; it was not
rebuilt. The product UI, database schema, migrations, authentication flows,
session tracking, analytics, revision, timeline, mistake memory, import/export,
admin controls, and Monaco execution pipeline remain in place.

The repository is now **code-ready for a managed production deployment**, but
it is not honestly “live” yet. A live URL requires external accounts,
credentials, a production database, and a domain. Those values must be entered
directly in provider/Vercel dashboards and must never be pasted into chat or
committed.

## Native-platform completion

The repository now also contains the complete native Quadrantcode practice
workflow described in `docs/native-platform.md`:

1. Exactly 100 independently authored DSA problem records, with the required
   35 easy / 45 medium / 20 hard and topic distribution.
2. C11, C++17, Java, Python 3 and JavaScript templates, wrappers and trusted
   references for every problem. Local compiler validation executed 3,000
   reference/test pairs successfully.
3. Native Run and Submit, hidden-test redaction, persisted attempts and
   server-verified learning effects.
4. Company preparation pages, honest evidence labels, moderated candidate
   reports and the frequent-report threshold of three independent reports.
5. Exactly 20 original pattern-based mock papers, two for each target company,
   plus timed attempts and per-question scoring.
6. Admin review, preview, content editing, provider validation, publish gates,
   audit history and guarded import/export.

Generated content intentionally imports as `needs_review`. Local compiler
validation is strong reproducible evidence, but it is not a real Judge0 run.
Publishing therefore still requires an administrator to validate every
language/test combination through the configured production Judge0 provider.

## Completed in this pass

1. Added cross-field environment validation and a Vercel deployment gate.
2. Added provider-neutral direct database URL support for migrations.
3. Removed silent production fallbacks: no fake execution verdict, empty
   Resend provider, console OTP, in-memory storage, or per-instance limiter can
   masquerade as production behavior.
4. Made unavailable email, phone, storage, and execution features explicit and
   controlled.
5. Added Sentry SDK wiring for browser, Node, Edge, nested server errors, and
   React error boundaries. Source-map upload remains blocked on Sentry account
   values.
6. Added CSP, HSTS, clickjacking, MIME-sniffing, referrer, permissions, and
   opener-policy headers.
7. Added liveness (`/api/health/live`) and readiness
   (`/api/health/ready`) endpoints while preserving `/api/health`.
8. Added metadata, canonical URLs, robots, sitemap, favicon, Open Graph image,
   404, root error, privacy, terms, security, and contact surfaces.
9. Added a manual, protected production migration workflow and documented the
   Vercel Git deployment path.
10. Updated vulnerable runtime dependencies/overrides identified by `npm audit`.

## Local release-gate evidence

Run on 1 September 2026 against a real local PostgreSQL test database:

| Gate                         | Result                                                                    |
| ---------------------------- | ------------------------------------------------------------------------- |
| TypeScript, ESLint, Prettier | pass                                                                      |
| Production build             | pass; 53 application pages generated                                      |
| Vitest                       | 1,202 pass; 5 optional credential tests skipped                           |
| Playwright                   | 118/118 pass against `next start` and a local Judge0 HTTP contract server |
| Native content               | 100/100 problems and 20/20 papers pass structural validation              |
| Reference execution          | 3,000/3,000 local compiler executions match expected output               |
| WCAG token contrast          | all pairs pass                                                            |
| Production dependency audit  | 0 vulnerabilities                                                         |
| Full dependency audit        | 4 moderate dev-only findings in Drizzle Kit's legacy esbuild dependency   |

This evidence makes the repository code-ready. It does not replace a preview
deployment, real provider tests, backup/restore drill, or post-deploy smoke
test.

## External launch blockers

| Blocker                                           | Needed for                                            |
| ------------------------------------------------- | ----------------------------------------------------- |
| Managed PostgreSQL pooled URL + direct URL        | durable production data and migrations                |
| Final HTTPS domain                                | canonical URLs, cookies, email links, OAuth callbacks |
| 32+ character `AUTH_SECRET`                       | Auth.js and OTP HMAC security                         |
| GitHub OAuth app ID/secret                        | GitHub sign-in                                        |
| Resend key, verified sending domain, from address | email magic links                                     |
| Upstash REST URL/token                            | distributed serverless rate limits                    |
| Sentry DSNs/org/project/build token               | monitoring and readable production stack traces       |
| Public support mailbox                            | legal/contact pages                                   |
| MSG91 key/template                                | phone OTP, only when that feature is enabled          |
| Judge0 URL/key                                    | real execution, only when execution is enabled        |
| S3-compatible avatar bucket credentials/domain    | avatar uploads                                        |

## Deliberately not claimed

- No production or preview deployment has been created from this workspace.
- No destructive production migration, DNS change, OAuth app creation, paid
  resource, or provider test has been performed.
- Queue-backed retries and scheduled background work are not part of the
  trimmed architecture. In-process jobs persist their state in Postgres, but a
  dead process requires the documented sweep/retry operations.
- Billing, notifications, contests, tracks, coins, and AI remain cut or
  disabled features. Their placeholder credentials do not make them built.

See `docs/deployment.md` for the exact launch sequence and
`docs/launch-checklist.md` for the final go/no-go checklist.
