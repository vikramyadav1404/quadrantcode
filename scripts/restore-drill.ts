/**
 * Restore-drill helper for F4.8 acceptance criterion 5.
 *
 *   npm run drill -- marker    write the marker row (PERMANENT — see below)
 *   npm run drill -- now       print the database clock
 *   npm run drill -- verify    marker lookup, row counts, table count
 *
 * `psql` is not assumed. This uses the `postgres` driver the project already
 * depends on, so the drill needs no client install.
 *
 * ## Which database, and why not DATABASE_URL
 *
 * Reads `NEON_DATABASE_URL`, or `DRILL_URL` when pointed at a restore branch.
 * It deliberately does **not** fall back to `DATABASE_URL`.
 *
 * The first version of this helper did fall back, and wrote a marker to
 * `localhost:55432` — the embedded test instance — because `.env` holds the
 * local URL. The transcript looked correct. A drill against the wrong database
 * proves nothing while producing evidence indistinguishable from a real one,
 * which is worse than a drill that fails loudly. Hence an explicit variable and
 * the host check below.
 *
 * ## The marker row is permanent
 *
 * `audit_logs` is append-only AT THE DATABASE: trigger `audit_logs_append_only`
 * refuses UPDATE and DELETE, and unlike `session_events` there is no purge
 * escape hatch. Migration 0019 explains why — "An audit log exists precisely so
 * that the people with power over other people's data cannot quietly erase what
 * they did — a purge flag would hand them the eraser."
 *
 * So there is no cleanup command, and there cannot be one. That is correct
 * rather than a compromise: a restore drill is a real operational event, an
 * audit log is where a permanent record of one belongs, and the row carries no
 * user data.
 */
import 'dotenv/config';
import postgres from 'postgres';

const MARKER = {
  actor: '00000000-0000-0000-0000-000000000000',
  action: 'ops.restore_drill',
  target: 'f4.8-criterion-5',
} as const;

const branchUrl = process.env.DRILL_URL;
const url = branchUrl ?? process.env.NEON_DATABASE_URL;

if (!url) {
  process.stdout.write(
    'No target database.\n\n' +
      '  Production : $env:NEON_DATABASE_URL = "<neon pooled connection string>"\n' +
      '  Branch     : $env:DRILL_URL = "<restore branch connection string>"\n\n' +
      'DATABASE_URL is deliberately not used: in this repo it points at the local\n' +
      'embedded test instance, and a drill against that proves nothing.\n',
  );
  process.exit(1);
}

let host: string;
try {
  host = new URL(url).host;
} catch {
  process.stdout.write('That does not parse as a connection URL.\n');
  process.exit(1);
}

/*
 * Refuse anything that is not Neon.
 *
 * Anchored on the suffix rather than a substring test, so `neon.tech.evil.com`
 * is rejected too. A drill is a claim about production recovery; run against
 * anything else it yields a transcript that reads identically and means
 * nothing.
 */
if (!/(^|\.)neon\.tech(:\d+)?$/.test(host)) {
  process.stdout.write(
    `REFUSING: ${host} is not a neon.tech host.\n\n` +
      'Set NEON_DATABASE_URL (production) or DRILL_URL (restore branch) to a\n' +
      'Neon connection string.\n',
  );
  process.exit(1);
}

const mode = process.argv[2];
const which = branchUrl ? 'DRILL_URL (restore branch)' : 'NEON_DATABASE_URL (production)';
process.stdout.write(`connected to ${host}  via ${which}\n\n`);

const sql = postgres(url, { max: 1, onnotice: () => {} });

try {
  if (mode === 'marker') {
    // The marker belongs on production. Writing it to the branch would prove
    // nothing, because the branch is created after the restore point.
    if (branchUrl) {
      process.stdout.write('REFUSING: the marker belongs on production, not the branch.\n');
      process.exit(1);
    }
    const [row] = await sql`
      INSERT INTO audit_logs (actor_id, action, target, diff)
      VALUES (${MARKER.actor}, ${MARKER.action}, ${MARKER.target},
              ${sql.json({ note: 'Restore drill marker. Written before the restore point.' })})
      RETURNING id, created_at
    `;
    const [clock] = await sql`SELECT now()`;
    process.stdout.write(`marker id     ${row!['id']}\n`);
    process.stdout.write(`created_at    ${(row!['created_at'] as Date).toISOString()}\n`);
    process.stdout.write(`db clock now  ${(clock!['now'] as Date).toISOString()}\n`);
    process.stdout.write('\nThis row is PERMANENT — audit_logs refuses DELETE.\n');
  } else if (mode === 'now') {
    const [clock] = await sql`SELECT now()`;
    process.stdout.write(`RESTORE POINT ${(clock!['now'] as Date).toISOString()}\n`);
  } else if (mode === 'verify') {
    const markers = await sql`
      SELECT id, created_at FROM audit_logs
      WHERE action = ${MARKER.action} AND target = ${MARKER.target}
      ORDER BY created_at
    `;
    process.stdout.write(`marker rows   ${markers.length}\n`);
    for (const marker of markers) {
      process.stdout.write(
        `  id ${marker['id']}  created_at ${(marker['created_at'] as Date).toISOString()}\n`,
      );
    }
    const [counts] = await sql`
      SELECT (SELECT count(*) FROM users)      AS users,
             (SELECT count(*) FROM problems)   AS problems,
             (SELECT count(*) FROM companies)  AS companies,
             (SELECT count(*) FROM audit_logs) AS audit_logs
    `;
    const [tables] = await sql`
      SELECT count(*) AS tables FROM information_schema.tables WHERE table_schema = 'public'
    `;
    process.stdout.write(
      `\nusers ${counts!['users']}  problems ${counts!['problems']}  ` +
        `companies ${counts!['companies']}  audit_logs ${counts!['audit_logs']}\n` +
        `tables ${tables!['tables']}\n`,
    );
  } else {
    process.stdout.write('usage: npm run drill -- marker|now|verify\n');
  }
} finally {
  await sql.end();
}
