/**
 * Rebuild every user's mistake patterns, on demand.
 *
 *   npm run mistakes:rollup
 *
 * The ticket asks for `jobs/monthly-report.processor.ts`. There is no queue to
 * host a processor (F2.3 is cut — **D17**), so this is the same on-demand shape
 * as `analytics:rollup`, `snapshots:purge` and `executions:sweep`.
 *
 * Nothing depends on it running. `/mistakes` rebuilds the current user's
 * patterns on read, which is cheap and always fresh; this exists for the case
 * where you want every user's rows populated without waiting for each of them
 * to visit — a report run, or a look at the data.
 */
import 'dotenv/config';
import { closeDb, getDb } from '@/server/db/client';
import { rebuildPatterns, usersWithSessions } from '@/server/services/mistakes';

async function main(): Promise<void> {
  const now = new Date();

  // Everyone who has solved anything in the last year. Older accounts have
  // nothing inside the trend windows, so rebuilding them writes the same rows.
  const since = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
  const users = await usersWithSessions(getDb(), since);

  let patterns = 0;
  for (const { userId } of users) {
    const rows = await rebuildPatterns(getDb(), { userId, now });
    patterns += rows.length;
  }

  console.log(
    JSON.stringify({
      event: 'mistakes.rollup',
      users: users.length,
      patterns,
      at: now.toISOString(),
    }),
  );

  await closeDb();
}

void main();
