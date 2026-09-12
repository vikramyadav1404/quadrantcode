/** Manual equivalent of the bounded daily execution reconciler. */
import 'dotenv/config';
import { Sandbox } from '@vercel/sandbox';
import { closeDb, getDb } from '@/server/db/client';
import { isFeatureEnabled } from '@/lib/flags';
import {
  cleanupPendingSandboxes,
  reconcileExecutionLeases,
  reconcileUndispatchedJobs,
  sweepStalledExecutions,
} from '@/server/services/execution';

async function main(): Promise<void> {
  const now = new Date();
  const db = getDb();
  try {
    const legacyFailed = await sweepStalledExecutions(db, now);
    const leases = await reconcileExecutionLeases(db, now);
    const cleanup = await cleanupPendingSandboxes(db, async (name) => {
      const sandbox = await Sandbox.get({ name });
      await sandbox.stop();
    });
    const dispatch = isFeatureEnabled('FEATURE_EXECUTION')
      ? await reconcileUndispatchedJobs(db, now)
      : { examined: 0, dispatched: 0 };

    console.log(
      JSON.stringify({
        event: 'executions.reconciled',
        legacyFailed,
        leases,
        cleanup,
        dispatch,
        at: now.toISOString(),
      }),
    );
  } finally {
    await closeDb();
  }
}

void main();
