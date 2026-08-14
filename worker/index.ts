/**
 * Standalone worker entrypoint.
 *
 * Started with `npm run worker`, independently of `npm run dev`.
 *
 * **F2.3 (`job-runtime`) is cut, so no BullMQ queues will ever attach here.**
 * What remains useful is the lifecycle: env validation at boot, a readiness
 * log, and graceful shutdown on SIGTERM/SIGINT — which is what a scheduled
 * maintenance process (stall sweeps, avatar cleanup) would need if one is ever
 * run. Today nothing schedules those; recovery is user-driven. See D17.
 *
 * Imports `@/server/db/client` rather than `@/server/db`: the latter carries a
 * `server-only` guard meant for the Next bundler, which throws in plain Node.
 * See server/db/client.ts.
 *
 * Why this cannot run on Vercel — see README §Worker deployment.
 */
import 'dotenv/config';
import { getServerEnv } from '@/server/env';
import { allFeatureFlags } from '@/lib/flags';
import { closeDb } from '@/server/db/client';

process.env.TRACELOOP_ROLE = 'worker';

/** Run in order on shutdown. */
const shutdownHooks: Array<() => Promise<void>> = [];

export function onShutdown(hook: () => Promise<void>): void {
  shutdownHooks.push(hook);
}

let shuttingDown = false;

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(JSON.stringify({ event: 'worker.shutdown.start', signal }));

  const results = await Promise.allSettled(shutdownHooks.map((hook) => hook()));
  for (const result of results) {
    if (result.status === 'rejected') {
      console.error(
        JSON.stringify({ event: 'worker.shutdown.hook_failed', error: String(result.reason) }),
      );
    }
  }

  await closeDb();
  console.log(JSON.stringify({ event: 'worker.shutdown.complete' }));
  process.exit(0);
}

function main(): void {
  // Throws with a readable message if any required variable is missing.
  const env = getServerEnv();

  console.log(
    JSON.stringify({
      event: 'worker.started',
      node_env: env.NODE_ENV,
      pid: process.pid,
      queues: [], // none — F2.3 is cut
      flags: allFeatureFlags(),
    }),
  );

  process.on('SIGTERM', (signal) => void shutdown(signal));
  process.on('SIGINT', (signal) => void shutdown(signal));

  // Keeps the process alive. With F2.3 cut nothing attaches to this, which
  // hold the event loop open on their own.
  setInterval(() => {
    /* heartbeat placeholder — no queue workers exist; see D17 */
  }, 60_000);
}

main();
