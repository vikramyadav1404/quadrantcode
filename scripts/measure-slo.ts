/**
 * Measure the project against its own SLOs.
 *
 *   npm run slo:measure
 *
 * ## An undocumented or unmeasured SLO is not an SLO
 *
 * The ticket's words. So this measures rather than asserting, and prints what
 * it found — the README carries THOSE numbers, not aspirational ones.
 *
 * ## What can and cannot be measured here
 *
 * p95 latency for the read paths: **yes**, against a real database, by running
 * them. That is a genuine measurement of the code, on this machine, with this
 * data volume — not production, and the README says so.
 *
 * Uptime and notification delivery: **no**. Uptime needs a deployment being
 * watched over time, and notifications need F2.4, which is cut. Printing a
 * number for either would be inventing one.
 */
import 'dotenv/config';
import { closeDb, getDb } from '@/server/db/client';
import { listProblems } from '@/server/services/problems';
import { ensureFreshRollup, readDashboard } from '@/server/services/analytics';
import { localDateFor } from '@/server/services/streak';
import { sql } from 'drizzle-orm';

/** Runs `fn` `count` times and returns the p95 in milliseconds. */
async function p95(count: number, fn: () => Promise<unknown>): Promise<number> {
  const samples: number[] = [];

  for (let run = 0; run < count; run += 1) {
    const started = performance.now();
    await fn();
    samples.push(performance.now() - started);
  }

  samples.sort((a, b) => a - b);
  // Ceiling index, so p95 of 20 samples is the 19th rather than the 19th-ish.
  return samples[Math.min(samples.length - 1, Math.ceil(samples.length * 0.95) - 1)]!;
}

async function main(): Promise<void> {
  const db = getDb();
  const now = new Date();

  const [user] = await db.execute<{ id: string; timezone: string }>(
    sql`select id, timezone from users limit 1`,
  );

  if (!user) {
    console.log(
      JSON.stringify({
        event: 'slo.measure',
        error: 'no users in this database — nothing to measure against',
      }),
    );
    await closeDb();
    return;
  }

  const today = localDateFor(now, String(user['timezone']));
  const userId = String(user['id']);

  const catalog = await p95(20, () =>
    listProblems({ db, filters: { limit: 20, includeHidden: false }, userId }),
  );

  const status = await ensureFreshRollup(db, { userId, today, now });
  const dashboard = await p95(20, () =>
    readDashboard(db, { userId, today, asOf: status.asOf, catchingUp: status.catchingUp }),
  );

  console.log(
    JSON.stringify(
      {
        event: 'slo.measure',
        note: 'measured on this machine against the test database — not production',
        samples: 20,
        p95Ms: {
          catalog: Math.round(catalog),
          dashboard: Math.round(dashboard),
        },
        notMeasured: {
          uptime: 'needs a deployment observed over time',
          notificationDelivery: 'F2.4 is cut — nothing sends notifications',
        },
        at: now.toISOString(),
      },
      null,
      2,
    ),
  );

  await closeDb();
}

void main();
