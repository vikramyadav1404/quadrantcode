/**
 * Standalone worker entrypoint.
 *
 * Started with `npm run worker`, independently of `npm run dev`. F2.3
 * (`job-runtime`) replaces the placeholder loop below with real BullMQ queues;
 * this file already owns the lifecycle those queues plug into: env validation
 * at boot, a readiness log, and graceful shutdown on SIGTERM/SIGINT.
 *
 * Why this cannot run on Vercel — see README §Worker deployment.
 */
import 'dotenv/config';
import { getEnv } from '@/lib/env';
import { allFeatureFlags } from '@/lib/flags';
import { closeDb } from '@/server/db';

process.env.TRACELOOP_ROLE = 'worker';

/** Registered by each queue in F2.3; run in order on shutdown. */
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
  const env = getEnv();

  console.log(
    JSON.stringify({
      event: 'worker.started',
      node_env: env.NODE_ENV,
      pid: process.pid,
      queues: [], // populated in F2.3
      flags: allFeatureFlags(),
    }),
  );

  process.on('SIGTERM', (signal) => void shutdown(signal));
  process.on('SIGINT', (signal) => void shutdown(signal));

  // Keeps the process alive until F2.3 attaches real BullMQ workers, which
  // hold the event loop open on their own.
  setInterval(() => {
    /* heartbeat placeholder — replaced by queue workers in F2.3 */
  }, 60_000);
}

main();
