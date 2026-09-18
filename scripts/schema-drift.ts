/**
 * Does this database match the migration files?
 *
 *   npm run schema:check
 *
 * Reads `SCHEMA_CHECK_URL`, then `NEON_DATABASE_URL`, then `DATABASE_URL`.
 * Writes nothing. Exits non-zero on drift.
 *
 * ## Why this is not answered by "migrations applied"
 *
 * Drizzle decides what to apply by timestamp, not by content. A migration file
 * that is edited *after* it has been applied is therefore never re-run, and
 * `db:migrate` reports success while changing nothing.
 *
 * That happened here. `dac85c8` (2026-09-13, "rename traceloop to quadrantcode
 * throughout") rewrote the body of migrations that had already run, including
 * the name of the session-local flag the `session_events` append-only trigger
 * checks. Any database migrated before that date still has a trigger reading
 * `traceloop.purging`, while `server/services/timeline/retention.ts` sets
 * `quadrantcode.purging`. The consequences are not cosmetic: `snapshots:purge`
 * backs the ninety-day retention promise, and account deletion is the same
 * cascade. Both would be refused by the database.
 *
 * **A fresh clone is unaffected.** Migrating from nothing applies the current
 * files and produces the current schema. The exposure is long-lived databases,
 * which is exactly where nobody looks.
 *
 * ## What it compares
 *
 * Expected values come from the migration files, not from application code, so
 * this stays a question about the database rather than about imports — and it
 * needs none, which matters because `retention.ts` sits behind `server-only`.
 *
 * 1. Recorded migration hashes against the files they came from
 * 2. The purge flag the trigger actually reads against the one the files set
 * 3. Table count, reported for context — it does **not** discriminate. A
 *    drifted database and a current one both report 48.
 */
import 'dotenv/config';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import postgres from 'postgres';

const MIGRATIONS = 'server/db/migrations';

const url =
  process.env['SCHEMA_CHECK_URL'] ??
  process.env['NEON_DATABASE_URL'] ??
  process.env['DATABASE_URL'];

if (!url) {
  process.stdout.write('No target. Set SCHEMA_CHECK_URL, NEON_DATABASE_URL or DATABASE_URL.\n');
  process.exit(1);
}

let target: URL;
try {
  target = new URL(url);
} catch {
  process.stdout.write('That does not parse as a connection URL.\n');
  process.exit(1);
}

/*
 * Print the target before anything else, and print the database name too.
 *
 * A read-only check cannot damage the wrong database, but it can report
 * "CURRENT" about one nobody meant to ask about. The local instance holds
 * several databases that differ only by name, and one of them is stale.
 */
process.stdout.write(`checking  ${target.host}${target.pathname}  (read only)\n\n`);

const files = readdirSync(MIGRATIONS)
  .filter((name) => name.endsWith('.sql'))
  .sort();

const sources = files.map((name) => readFileSync(`${MIGRATIONS}/${name}`, 'utf8'));
const hashes = new Set(sources.map((body) => createHash('sha256').update(body).digest('hex')));

/** The flag the migration files tell the trigger to check. */
const expectedFlags = new Set<string>();
for (const body of sources) {
  for (const [, flag] of body.matchAll(/current_setting\('([^']+)'/g)) {
    if (flag !== undefined) expectedFlags.add(flag);
  }
}

const sql = postgres(url, { max: 1, onnotice: () => {} });
let drifted = false;

try {
  const recorded = await sql`
    SELECT hash FROM drizzle.__drizzle_migrations ORDER BY created_at
  `;

  const matching = recorded.filter((row) => hashes.has(String(row['hash']))).length;
  const stale = recorded.length - matching;

  process.stdout.write(`migration files   ${files.length}\n`);
  process.stdout.write(`recorded applied  ${recorded.length}\n`);
  process.stdout.write(`hashes matching   ${matching}\n`);

  if (stale > 0) {
    drifted = true;
    process.stdout.write(
      `\n  ${stale} recorded migration(s) no longer match the file they came from.\n` +
        '  Those files were edited after they ran. db:migrate will not fix this.\n',
    );
  }

  const functions = await sql`
    SELECT p.proname, pg_get_functiondef(p.oid) AS def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname LIKE '%reject%'
    ORDER BY p.proname
  `;

  process.stdout.write('\ntrigger functions\n');
  for (const fn of functions) {
    const found = /current_setting\('([^']+)'/.exec(String(fn['def']));
    const flag = found?.[1];
    const ok = flag === undefined || expectedFlags.has(flag);
    if (!ok) drifted = true;
    process.stdout.write(
      `  ${String(fn['proname']).padEnd(36)} ${flag ?? '(no flag)'}${ok ? '' : '   <-- NOT IN THE MIGRATION FILES'}\n`,
    );
  }

  if (functions.length === 0) {
    drifted = true;
    process.stdout.write('  none found — this database has not been migrated.\n');
  }

  const [tables] = await sql`
    SELECT count(*) AS n FROM information_schema.tables WHERE table_schema = 'public'
  `;
  process.stdout.write(`\ntables ${tables!['n']}  (context only — does not discriminate)\n`);
} finally {
  await sql.end();
}

process.stdout.write(
  drifted
    ? '\nDRIFTED. This database does not match the migration files.\n' +
        'Rebuild it, or hand-apply the difference. Migrating will not repair it.\n'
    : '\nCURRENT. This database matches the migration files.\n',
);

process.exit(drifted ? 1 : 0);
