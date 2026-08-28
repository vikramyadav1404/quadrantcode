/**
 * Drop code snapshots past the retention window, on demand.
 *
 *   npm run snapshots:purge
 *
 * Exists because F2.3 (`job-runtime`) is cut, so nothing schedules it (D17).
 * The ticket asks for `jobs/snapshot-cleanup.processor.ts`; there is no queue to
 * host a processor, and pretending otherwise would leave a file nothing runs.
 *
 * **Retention is a promise, and this script is the only thing that keeps it.**
 * The privacy copy will say snapshots are kept for ninety days; until something
 * schedules this, that sentence is true only as often as someone runs it. That
 * is stated in the acceptance record rather than left for a user to discover.
 *
 * Events are not touched. A snapshot is the user's code; an event is the fact
 * that something happened, which the timeline, the streak and the analytics
 * rollups are all built from.
 */
import 'dotenv/config';
import { closeDb, getDb } from '@/server/db/client';
import { purgeExpiredSnapshots } from '@/server/services/timeline';

async function main(): Promise<void> {
  const now = new Date();
  const { deleted, before } = await purgeExpiredSnapshots(getDb(), now);

  console.log(
    JSON.stringify({
      event: 'snapshots.purge',
      deleted,
      olderThan: before.toISOString(),
      at: now.toISOString(),
    }),
  );

  await closeDb();
}

void main();
