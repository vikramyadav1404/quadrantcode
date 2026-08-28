/**
 * Fail executions whose runner went away, on demand.
 *
 *   npm run executions:sweep
 *
 * Exists because F2.3 (`job-runtime`) is cut, so nothing schedules this (D17).
 * Unlike the session sweep, **something does depend on it running.**
 *
 * A job stuck at `running` counts against its owner's concurrency cap forever.
 * Five of them and that user cannot execute anything again — not degraded, not
 * slower: locked out of the feature until a row changes. A deploy mid-run is
 * enough to leave one behind, because the runner is in-process.
 *
 * Until something schedules it, the honest operational note is: run this after
 * every deploy. That is written in the README next to the limits, not only
 * here.
 */
import 'dotenv/config';
import { closeDb, getDb } from '@/server/db/client';
import { sweepStalledExecutions } from '@/server/services/execution';

async function main(): Promise<void> {
  const now = new Date();
  const failed = await sweepStalledExecutions(getDb(), now);

  console.log(JSON.stringify({ event: 'executions.sweep', failed, at: now.toISOString() }));
  await closeDb();
}

void main();
