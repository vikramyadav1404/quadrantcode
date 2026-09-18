/**
 * Does this database match the migration files?
 *
 *   npm run schema:check
 *
 * Reads `SCHEMA_CHECK_URL`, then `NEON_DATABASE_URL`, then `DATABASE_URL`.
 * Writes nothing. Exits non-zero when the append-only triggers disagree with
 * the migration files — not when a recorded hash does.
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
 * 1. **The purge flag the trigger actually reads**, against the one the files
 *    set. This is the only signal that decides the verdict, because it is the
 *    only one that observes the schema.
 * 2. Recorded migration hashes, reported as provenance. They never fail the
 *    run — see the note at the comparison itself for why they cannot.
 * 3. Table count, for context — it does **not** discriminate. A database with
 *    the wrong triggers and a correct one both report 48.
 *
 * What it does **not** compare: columns, constraints, indexes, defaults,
 * enums. A pass here is not a statement about the whole schema, and the
 * output says so rather than leaving it to be assumed.
 */
import 'dotenv/config';
import { execFileSync } from 'node:child_process';
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

/*
 * `--explain` maps each recorded hash back to the version of the file it came
 * from, by indexing every historical version of every migration in git.
 *
 * A count alone says a database is drifted without saying from what, and the
 * count on its own can be actively misleading: "18 of 25 differ" reads like
 * eighteen schema changes, when it may be one sweep that touched eighteen
 * files and changed nothing a database can observe.
 *
 * Both line endings are indexed. A blob is stored LF; a checkout with
 * `core.autocrlf` true hashes as CRLF, and that alone would make every
 * migration look edited.
 */
function buildHistory(): Map<string, string> {
  const git = (...args: string[]) =>
    execFileSync('git', args, { encoding: 'utf8', maxBuffer: 1 << 28 });

  const index = new Map<string, string>();
  const commits = git('log', '--format=%H %ad', '--date=short', '--', MIGRATIONS)
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => ({ sha: line.slice(0, 40), date: line.slice(41) }));

  for (const commit of commits) {
    const paths = git('ls-tree', '-r', '--name-only', commit.sha, '--', MIGRATIONS)
      .trim()
      .split('\n')
      .filter((p) => p.endsWith('.sql') && !p.includes('/down/'));

    for (const path of paths) {
      const body = git('show', `${commit.sha}:${path}`);
      const name = path.split('/').pop() ?? path;
      /*
       * Label the line-ending variant, because it is the difference between
       * "someone edited this migration" and "this was migrated from a Windows
       * checkout". Without the label a CRLF hash reads as an edit, which is
       * the wrong conclusion and the expensive one.
       */
      const crlf = body.replace(/\n/g, '\r\n');
      /*
       * Only offer CRLF when it is actually a different string. A migration
       * with no line breaks -- several here are a single CREATE INDEX -- hashes
       * identically either way, and labelling that one "CRLF" invents a
       * Windows checkout that the evidence does not show.
       */
      const variants: [string, string][] =
        crlf === body
          ? [[body, 'LF']]
          : [
              [body, 'LF'],
              [crlf, 'CRLF'],
            ];
      // Oldest wins: git log is newest-first, so later writes are earlier commits.
      for (const [content, ending] of variants) {
        index.set(
          createHash('sha256').update(content).digest('hex'),
          `${name} @ ${commit.sha.slice(0, 7)} ${commit.date}  ${ending}`,
        );
      }
    }
  }
  return index;
}

const explain = process.argv.includes('--explain');
const sql = postgres(url, { max: 1, onnotice: () => {} });
let drifted = false;

try {
  const recorded = await sql`
    SELECT hash, created_at FROM drizzle.__drizzle_migrations ORDER BY created_at
  `;

  const matching = recorded.filter((row) => hashes.has(String(row['hash']))).length;
  const stale = recorded.length - matching;

  process.stdout.write(`migration files   ${files.length}\n`);
  process.stdout.write(`recorded applied  ${recorded.length}\n`);
  process.stdout.write(`hashes matching   ${matching}\n`);

  /*
   * A stale hash is a provenance record, not a defect, and it is reported as
   * one. It does not fail the check.
   *
   * `pg-core/dialect.cjs` reads one row -- `order by created_at desc limit 1`
   * -- and applies every migration whose folderMillis exceeds it. The `hash`
   * column is written and never read for any decision. So a mismatched hash
   * says a file changed after it ran; it says nothing about the live schema,
   * it does not affect future migrations, and Postgres never consults it.
   *
   * The converse matters more: a matching hash does not prove the schema is
   * right either. Anyone can ALTER a table by hand and every hash still
   * agrees. Only the schema can answer a question about the schema, which is
   * what the trigger comparison below is for.
   */
  if (stale > 0) {
    process.stdout.write(
      `\n  ${stale} recorded hash(es) differ from the current file. That is a record of\n` +
        '  editing, not a fault: the migrator compares timestamps, never hashes.\n',
    );
    if (!explain) {
      process.stdout.write('  Re-run with --explain to see which version each came from.\n');
    }
  }

  if (explain) {
    const history = buildHistory();
    process.stdout.write('\nprovenance of each recorded migration\n');
    for (const row of recorded) {
      const hash = String(row['hash']);
      const current = hashes.has(hash);
      const origin = history.get(hash);
      process.stdout.write(
        `  ${hash.slice(0, 12)}  ${current ? 'current ' : 'STALE   '}` +
          `${origin ?? 'NOT ANY VERSION IN GIT — hand-edited, or built elsewhere'}\n`,
      );
    }
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

/*
 * The verdict is about the schema, and only about the part of it this script
 * actually looked at. An earlier version said "matches the migration files" on
 * the strength of two trigger functions, which is a claim the evidence could
 * not carry, and it was believed.
 */
process.stdout.write(
  drifted
    ? '\nDRIFTED. The append-only triggers do not match the migration files.\n' +
        'Erasure paths -- snapshots:purge, account deletion, demo:seed --clean --\n' +
        'will be refused. Rebuild the database, or hand-apply the difference;\n' +
        'migrating will not repair it.\n'
    : '\nTRIGGERS OK. The append-only triggers match the migration files.\n' +
        'That is what was checked -- not the whole schema. Columns, constraints\n' +
        'and indexes are not compared here.\n',
);

process.exit(drifted ? 1 : 0);
