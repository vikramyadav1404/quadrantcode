/**
 * Close solve sessions nobody came back to, on demand.
 *
 *   npm run sessions:sweep
 *
 * Exists because F2.3 (`job-runtime`) is cut, so the six-hour rule has no queue
 * to be scheduled on. The request path already closes the CURRENT user's stale
 * session — that is free, since the shell had to load it anyway — so this is
 * only for everyone else: users who stopped mid-session and have not returned.
 *
 * Nothing depends on it running. A session left live blocks nothing (the
 * owner's next start sweeps it first) and distorts nothing except a count of
 * live sessions. Run it from a host cron or by hand; see D17.
 */
import 'dotenv/config';
import { closeDb, getDb } from '@/server/db/client';
import { sweepAbandonedSessions } from '@/server/services/session';

async function main(): Promise<void> {
  const now = new Date();
  const closed = await sweepAbandonedSessions(getDb(), { now });

  console.log(JSON.stringify({ event: 'sessions.sweep', closed, at: now.toISOString() }));
  await closeDb();
}

void main();
