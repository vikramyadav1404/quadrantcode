/**
 * Rebuild the analytics rollup, on demand.
 *
 *   npm run analytics:rollup
 *   npm run analytics:rollup -- --days=365
 *
 * Exists because F2.3 (`job-runtime`) is cut, so there is no nightly job to
 * recompute anything. The dashboard tops up its own user's stale days on load,
 * capped — this is what covers everyone else, and what rebuilds history after a
 * change to how a number is computed.
 *
 * Safe to run at any time: a day is deleted and rewritten in one transaction, so
 * running it twice produces one row set and a dashboard loading mid-run sees the
 * previous numbers rather than none. See D17 and the head of `rollup.ts`.
 */
import 'dotenv/config';
import { closeDb, getDb } from '@/server/db/client';
import { rebuildWindow } from '@/server/services/analytics';
import { localDateFor } from '@/server/services/streak';
import { users } from '@/server/db/schema';

const DEFAULT_DAYS = 180;

async function main(): Promise<void> {
  const arg = process.argv.find((value) => value.startsWith('--days='));
  const days = arg ? Number(arg.split('=')[1]) : DEFAULT_DAYS;

  if (!Number.isInteger(days) || days < 1) {
    console.error(
      JSON.stringify({ event: 'analytics.rollup', error: 'days must be a positive integer' }),
    );
    process.exitCode = 1;
    return;
  }

  const db = getDb();
  const now = new Date();

  // Every user's own timezone decides their "today" — a single server-side date
  // would file the last day of history under the wrong day for half of them (D18).
  const everyone = await db.select({ id: users.id, timezone: users.timezone }).from(users);

  let rebuilt = 0;
  for (const user of everyone) {
    rebuilt += await rebuildWindow(db, {
      userId: user.id,
      today: localDateFor(now, user.timezone),
      days,
      now,
    });
  }

  console.log(
    JSON.stringify({
      event: 'analytics.rollup',
      users: everyone.length,
      daysPerUser: days,
      dayRollupsRebuilt: rebuilt,
      at: now.toISOString(),
    }),
  );

  await closeDb();
}

void main();
