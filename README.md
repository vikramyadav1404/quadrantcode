# Quadrantcode

**A DSA practice tracker that records _how_ you solved a problem, not that you solved it.**

[![CI](https://github.com/vikramyadav1404/quadrantcode/actions/workflows/ci.yml/badge.svg)](https://github.com/vikramyadav1404/quadrantcode/actions/workflows/ci.yml)
![License: PolyForm Noncommercial 1.0.0](https://img.shields.io/badge/license-PolyForm%20Noncommercial%201.0.0-blue)

**[quadrantcode.vercel.app](https://quadrantcode.vercel.app)**

---

## The problem

You grind a hundred problems, and three weeks later you cannot answer the only
questions that matter: **where did I get stuck, what did I get wrong, and what
should I revise first?**

The platforms you solve on record an outcome — accepted, or not. They do not
record the twenty minutes you spent on an off-by-one, or that this is the fourth
time binary-search bounds have cost you a session.

Quadrantcode records that part. You still solve on LeetCode; this keeps the
history that makes practice compound.

## 📸 Screenshots

|                                                       |                                                     |
| ----------------------------------------------------- | --------------------------------------------------- |
| ![Solve screen](docs/screenshots/01-solve.png)        | ![Dashboard](docs/screenshots/02-dashboard.png)     |
| **Solve** — editor, problem panel, server-owned timer | **Dashboard** — streak, daily goal, activity        |
| ![Session timeline](docs/screenshots/03-session.png)  | ![Revision queue](docs/screenshots/04-revision.png) |
| **Session** — run attempts, snapshots, stuck points   | **Revision** — what is due, and why                 |

## 🧭 What it does

|                                |                                                                                      |
| ------------------------------ | ------------------------------------------------------------------------------------ |
| **Server-authoritative timer** | The client sends intent, never a duration. A closed laptop cannot inflate a session. |
| **Run attempts**               | Every execution recorded with its verdict, kept against the session.                 |
| **Stuck points**               | You mark them; heuristics suggest them. Which one it was decides how much it counts. |
| **Reflections**                | A mistake taxonomy declared once in code, not free text nobody can query.            |
| **Code snapshots**             | Diff-based history of how the solution actually evolved.                             |
| **Spaced revision**            | A ladder plus a forgetting-risk score, over a timezone-correct day boundary.         |
| **Mistake memory**             | Recurring categories surfaced as weak topics.                                        |

## ⚠️ Honest status

This is a portfolio build. It is complete as software and **not operating as a
service**. Specifically:

- **Every `FEATURE_*` flag ships `false`** — all five, in `.env.example`.
- **Code execution has never run in production.** The queue, leases, fencing and
  recovery are built and covered by tests. `resolveProvider` returns a fake that
  executes nothing; the Judge0 provider is written and **unverified** against a
  real instance. Nothing here is a sandbox, and the limits are what gets _sent_,
  not what gets _enforced_.
- **Problem statements live on LeetCode by design.** This stores metadata and a
  link — never statements, examples, editorials or tests. That is enforced by a
  database `CHECK`, not by convention, so a service bug cannot leak around it.
- **The bundled problem library is not what its count suggests.** 100 records
  resolve to **16 unique test-case sets**: six hand-authored problems and ten
  generated patterns wearing ninety-four names. None of it is published — every
  record imports at `needs_review`. It is being replaced by hand.
- Email delivery, phone OTP and code execution are unprovisioned — the
  integrations exist behind a seam, the credentials do not. **There is no
  billing at all**: subscriptions were cut from scope rather than stubbed, so
  there is no payment code to be unprovisioned.

Nothing above is hidden in a footnote because the alternative is a reader
discovering it themselves and distrusting everything else.

## 🏗️ Architecture

**The log is append-only, at the database.** `session_events` refuses `UPDATE`
always, and refuses `DELETE` unless a session-local flag is set inside a
transaction — which exactly one module may set. "Delete my history" is a real
requirement and so is an unfalsifiable log; the flag is where they meet, and it
is a deliberate statement rather than an ambient permission.

**The session is its events.** There is no `duration` column. Elapsed time is
derived from the log, because a stored duration is a second source of truth that
drifts the first time a process dies mid-session.

**Execution is a table, a lease and a provider seam.** Jobs are rows; workers
claim them with a fenced lease so a deploy mid-run cannot produce two verdicts
for one attempt. The provider behind the seam is swappable and currently fake.

**The dashboard is precomputed.** Three rollup tables, because there are three
grains. Charts are inline SVG — the charting library in the original plan was
never installed, and the reasoning is in the decision log.

## 🧱 Tech stack

| Layer      | Choice                                                                          |
| ---------- | ------------------------------------------------------------------------------- |
| Framework  | Next.js 15 (App Router), React 19                                               |
| Language   | TypeScript, `strict` + `noUncheckedIndexedAccess`                               |
| Styling    | Tailwind CSS 4, custom token layer with a contrast gate in CI                   |
| Database   | PostgreSQL (Neon), Drizzle ORM, 25 versioned migrations with hand-written downs |
| Auth       | Auth.js v5 — magic link and GitHub, database sessions                           |
| Validation | Zod 4 at every API boundary                                                     |
| Tests      | Vitest, Playwright                                                              |

Charts are hand-written SVG; **Recharts is not a dependency**.

## 🚀 Local setup

```bash
git clone https://github.com/vikramyadav1404/quadrantcode.git
cd quadrantcode
npm install
npm run build
```

**Clone, install and build work with zero configuration** — verified 2026-09-20
from a fresh clone with no `.env` file present at all: 731 packages, build exit
code 0.

**Running the app does not.** A successful build is not a running application;
it needs a database and an environment.

```bash
cp .env.example .env.local
```

`.env.example` documents **43 variables**, each with a one-line comment. The
minimum to get running is far smaller than that:

| Variable              | Requirement                                                                                                   |
| --------------------- | ------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`        | **The only variable with no default.** Postgres connection string; the app will not start without it.         |
| `AUTH_SECRET`         | Needed to sign in at all, and mandatory in production at ≥ 32 chars. `openssl rand -base64 32`.               |
| `NEXT_PUBLIC_APP_URL` | Defaults to `http://localhost:3000`. Set it for any real deployment — magic links and OG images are absolute. |

Everything else gates an optional integration. Locally, some fall back to
development stand-ins — an unset `MSG91_AUTH_KEY` prints OTPs to the server
console.

**In production those stand-ins refuse to run.** The console OTP provider throws
rather than pretend to send an SMS, and `EXECUTION_BACKEND=fake` is rejected by
environment validation outright. A half-configured integration is treated as
absent rather than as working, which is the difference between a feature being
off and a feature being quietly wrong.

```bash
npm run db:migrate
npm run dev
```

Requires **Node ≥ 22**.

## 🧪 Testing

```bash
npm run test:db:start   # embedded Postgres on :55432 — this process IS the database
TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:55432/quadrantcode_test npm test
npm run test:e2e        # Playwright; needs a build first
npm run contrast        # WCAG token audit, non-zero on failure
npm run schema:check    # does a database match the migration files?
```

| Suite              | Result                                 | Source                                                     |
| ------------------ | -------------------------------------- | ---------------------------------------------------------- |
| Unit + integration | **1,290 passing, 5 skipped**, 88 files | `npm test` against a real Postgres, 2026-09-20             |
| Browser            | 143 tests in 23 files                  | `npx playwright test --list`, 2026-09-20 — listed, not run |

The unit suite takes about **20 minutes** against a real database. The five
skips are a live-bucket storage suite that needs `STORAGE_INTEGRATION=1`.

**Postgres-backed suites skip silently without `TEST_DATABASE_URL`.** A run that
reports far fewer tests has not passed more easily — it has tested less. Check
the count, not the colour.

CI runs typecheck, lint, format, a contrast audit, the test suite, a deployment
contract check, the build, and a **gitleaks scan over full history**.

## 🧠 Engineering decisions

Twenty-eight are recorded in [`docs/decisions.md`](docs/decisions.md), with the
alternatives that were rejected. Four worth reading:

### D28 · A hash proves nothing about a schema

A drift checker compared recorded migration hashes and reported the production
database as **DRIFTED**. It was wrong, and it blocked a deploy step.

Drizzle's migrator reads one row and compares **timestamps**; the `hash` column
is written and never read for any decision. A mismatch means a file was edited
after it ran — it says nothing about the live schema. The converse is sharper: a
**matching** hash proves nothing either, since a hand-run `ALTER TABLE` leaves
every hash agreeing.

The real cause was line endings. Eighteen of twenty-five hashes were the CRLF
encoding of the current file content — byte-identical migrations, recorded from
a Windows checkout. The check now decides on observable schema and prints what
it did _not_ compare, so a pass cannot be read as more than it is.

### D24 · Execution is a table, a lock and a provider seam — never a sandbox

Untrusted code execution needs isolation this project does not provide. Calling
the provider seam a sandbox would be the single most misleading sentence
available, so nothing here describes it as one.

`EXECUTION_LIMITS` is what gets **sent** to a provider; whether anything enforces
it depends entirely on how that provider was deployed. A container contract with
real isolation was specified and has tests — but the image was never built, and
an unbuilt image isolates nothing. Since no provider is provisioned either, the
honest status is _built, tested, never run_.

### D25 · An append-only log that can still be erased on request

Two real requirements collide: the event log must be unfalsifiable, and a user
must be able to delete their history. Resolved at the database — the trigger
refuses mutation unless a transaction-local flag is set, and exactly one module
sets it. Not enforcement by convention: without the flag, no code path, no
migration and no `psql` session can remove a row.

The cost was real. It broke ten browser tests when it landed, because every
fixture that deleted a user cascaded into that table.

### D20 · The session record is its events, not a duration column

Storing elapsed time means storing a derived value that can disagree with the
events it came from — and it will, the first time a process dies mid-session.
Elapsed is computed from the log instead. Slightly more work on read, one fewer
thing that can be quietly wrong.

## 📄 License

[PolyForm Noncommercial 1.0.0](LICENSE) — use, study and modify it for any
purpose that is not commercial.

---

Company-style tracks are based on common public interview patterns and original
practice problems. **This project is not affiliated with or endorsed by any
company or coding platform.**
