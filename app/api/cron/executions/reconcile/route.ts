import { timingSafeEqual } from 'node:crypto';
import { Sandbox } from '@vercel/sandbox';
import { getDb } from '@/server/db';
import { getServerEnv } from '@/server/env';
import { isFeatureEnabled } from '@/lib/flags';
import {
  cleanupPendingSandboxes,
  reconcileExecutionLeases,
  reconcileUndispatchedJobs,
} from '@/server/services/execution';

export const runtime = 'nodejs';
// 60, not 90: the Hobby plan caps a function there and rejects the deployment
// above it. Ample for this route — it runs once a day and does three bounded
// sweeps (expired leases, undispatched rows, pending sandbox cleanup), each of
// which is a no-op while FEATURE_EXECUTION is off and there are no jobs.
export const maxDuration = 60;

export async function GET(request: Request): Promise<Response> {
  const env = getServerEnv();
  if (!env.CRON_SECRET || !authorized(request.headers.get('authorization'), env.CRON_SECRET)) {
    return Response.json({ error: 'Not found.' }, { status: 404 });
  }

  const db = getDb();
  const leases = await reconcileExecutionLeases(db);
  const cleanup = await cleanupPendingSandboxes(db, async (name) => {
    const sandbox = await Sandbox.get({ name });
    await sandbox.stop();
  });
  const dispatch = isFeatureEnabled('FEATURE_EXECUTION')
    ? await reconcileUndispatchedJobs(db)
    : { examined: 0, dispatched: 0 };

  return Response.json({ ok: true, leases, cleanup, dispatch });
}

function authorized(header: string | null, secret: string): boolean {
  const expected = Buffer.from(`Bearer ${secret}`);
  const actual = Buffer.from(header ?? '');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
