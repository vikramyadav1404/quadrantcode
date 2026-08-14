/**
 * Orphaned-avatar cleanup, on demand.
 *
 *   npm run avatars:cleanup
 *   npm run avatars:cleanup -- --max-age-hours=1
 *
 * Exists because F2.3 (`job-runtime`) is cut, so `cleanupOrphanedAvatars` has
 * no queue to be scheduled on. Without this it would be a tested function that
 * nothing can invoke — the worst kind of dead code, because it looks handled.
 *
 * Run it from a host cron or by hand. Orphans accumulate until it runs; see D17.
 */
import 'dotenv/config';
import { getDb, closeDb } from '@/server/db/client';
import { getServerEnv } from '@/server/env';
import { cleanupOrphanedAvatars } from '@/server/services/profile/avatar';
import { resolveStorage } from '@/server/services/storage';

async function main(): Promise<void> {
  const arg = process.argv.find((value) => value.startsWith('--max-age-hours='));
  const maxAgeHours = arg ? Number(arg.split('=')[1]) : undefined;

  const env = getServerEnv();
  const deleted = await cleanupOrphanedAvatars(
    { db: getDb(), storage: resolveStorage(env) },
    maxAgeHours === undefined ? {} : { maxAgeHours },
  );

  console.log(JSON.stringify({ event: 'avatars.cleanup', deleted, maxAgeHours }));
  await closeDb();
}

void main();
