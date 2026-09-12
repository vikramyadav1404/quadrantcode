/**
 * A load test for the two read paths a signed-in user hits most.
 *
 *   npm run loadtest
 *
 * ## What this is, and what it is not
 *
 * It drives the SERVICE functions with 100 concurrent callers against a real
 * database, and reports p50/p95/p99. That is a real measurement of the query
 * layer under contention — connection pool, planner, indexes.
 *
 * **It is not an HTTP load test.** No React rendering, no serialisation, no
 * network, no cold starts, no Vercel concurrency limits. The numbers below are
 * therefore a floor: production cannot be faster than this, and will be slower
 * by an amount this cannot measure. The audit report says so rather than
 * presenting these as end-to-end figures.
 *
 * A real one needs a deployed instance, which is blocked on the same
 * credentials as everything else.
 */
import 'dotenv/config';
import { sql } from 'drizzle-orm';
import { closeDb, getDb } from '@/server/db/client';
import { listProblems } from '@/server/services/problems';
import { ensureFreshRollup, readDashboard } from '@/server/services/analytics';
import { localDateFor } from '@/server/services/streak';

const CONCURRENCY = 100;

function percentile(samples: number[], fraction: number): number {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)] ?? 0;
}

async function measure(
  label: string,
  fn: () => Promise<unknown>,
): Promise<{ label: string; p50: number; p95: number; p99: number; failures: number }> {
  const samples: number[] = [];
  let failures = 0;

  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      const started = performance.now();
      try {
        await fn();
        samples.push(performance.now() - started);
      } catch {
        // Counted, not swallowed. A load test that reports latency while half
        // the calls failed is reporting the latency of failing.
        failures += 1;
      }
    }),
  );

  return {
    label,
    p50: Math.round(percentile(samples, 0.5)),
    p95: Math.round(percentile(samples, 0.95)),
    p99: Math.round(percentile(samples, 0.99)),
    failures,
  };
}

async function main(): Promise<void> {
  const db = getDb();
  const now = new Date();

  /*
   * A user to read as. Created if the database has none, and the output says
   * which — a load test against a freshly seeded empty account measures very
   * different queries from one against a year of history, and reporting the
   * number without that context would be the misleading half.
   */
  await db.execute(sql`
    insert into users (email, timezone, email_verified_at)
    values ('loadtest@quadrantcode.local', 'Asia/Kolkata', now())
    on conflict (email) do nothing
  `);

  const [user] = await db.execute<{ id: string; timezone: string }>(
    sql`select id, timezone from users order by created_at limit 1`,
  );

  if (!user) {
    console.log(JSON.stringify({ event: 'loadtest', error: 'could not create a user' }));
    await closeDb();
    return;
  }

  const [counts] = await db.execute<{ sessions: number; problems: number }>(sql`
    select
      (select count(*)::int from solve_sessions where user_id = ${String(user['id'])}) as sessions,
      (select count(*)::int from problems) as problems
  `);

  const userId = String(user['id']);
  const today = localDateFor(now, String(user['timezone']));
  const status = await ensureFreshRollup(db, { userId, today, now });

  const results = [
    await measure('problem catalog', () =>
      listProblems({ db, filters: { limit: 20, includeHidden: false }, userId }),
    ),
    await measure('analytics dashboard', () =>
      readDashboard(db, { userId, today, asOf: status.asOf, catchingUp: status.catchingUp }),
    ),
  ];

  console.log(
    JSON.stringify(
      {
        event: 'loadtest',
        note: 'SERVICE layer against a real database — not HTTP, not a deployment',
        concurrency: CONCURRENCY,
        // The shape of the data being read. Without it the latency below is a
        // number with no denominator.
        dataset: { sessions: counts?.['sessions'] ?? 0, problems: counts?.['problems'] ?? 0 },
        results,
        at: now.toISOString(),
      },
      null,
      2,
    ),
  );

  await closeDb();
}

void main();
