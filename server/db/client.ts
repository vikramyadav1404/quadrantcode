/**
 * Database connection.
 *
 * Deliberately WITHOUT `import 'server-only'`: the standalone worker imports
 * this module, and `server-only` throws in plain Node. Making the worker claim
 * to be an RSC environment (`--conditions=react-server`) would have silenced
 * the guard everywhere instead of placing it correctly.
 *
 * The layering instead is:
 *   server/db/client.ts  ← worker and app; guarded by ESLint + the boundary test
 *   server/db/index.ts   ← app only; adds the build-time `server-only` guard
 *
 * Application code should import `@/server/db`. Only `worker/` and `jobs/`
 * import this file directly.
 */
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { getServerEnv } from '@/server/env';
import * as schema from './schema';

export type Database = ReturnType<typeof drizzle<typeof schema>>;

/**
 * What `db.transaction(async (tx) => …)` hands its callback.
 *
 * Derived rather than written out, so it cannot drift from the driver's real
 * type. Needed the moment a helper has to run both inside a transaction and on
 * its own — F1.4's event writer is the first — because typing that helper as
 * `Database` silently excludes `tx`.
 */
export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

let client: ReturnType<typeof postgres> | undefined;
let database: Database | undefined;

/**
 * Pool sizing: Vercel serverless invocations are short-lived and numerous, so
 * the app keeps a small pool per instance and relies on the Supabase pooled
 * URL. The worker is long-lived and may hold more.
 */
function createClient(url: string) {
  const isWorker = process.env.QUADRANTCODE_ROLE === 'worker';
  return postgres(url, {
    max: isWorker ? 10 : 3,
    idle_timeout: 20,
    connect_timeout: 10,
    prepare: false, // pgbouncer transaction pooling does not support prepared statements
  });
}

export function getDb(): Database {
  if (!database) {
    client = createClient(getServerEnv().DATABASE_URL);
    database = drizzle(client, { schema, casing: 'snake_case' });
  }
  return database;
}

/** Closes the pool. Called by the worker's graceful-shutdown path. */
export async function closeDb(): Promise<void> {
  if (client) {
    await client.end({ timeout: 5 });
    client = undefined;
    database = undefined;
  }
}

export { schema };
