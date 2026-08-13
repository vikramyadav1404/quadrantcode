/**
 * Database handle shared by the Next.js app and the standalone worker.
 *
 * The connection is created lazily so importing this module (for types, or in
 * a unit test) never opens a socket.
 */
import 'server-only';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { getEnv } from '@/lib/env';
import * as schema from './schema';

export type Database = ReturnType<typeof drizzle<typeof schema>>;

let client: ReturnType<typeof postgres> | undefined;
let database: Database | undefined;

/**
 * Pool sizing: Vercel serverless invocations are short-lived and numerous, so
 * the app keeps a small pool per instance and relies on the Supabase pooled
 * URL. The worker is long-lived and may hold more.
 */
function createClient(url: string) {
  const isWorker = process.env.TRACELOOP_ROLE === 'worker';
  return postgres(url, {
    max: isWorker ? 10 : 3,
    idle_timeout: 20,
    connect_timeout: 10,
    prepare: false, // pgbouncer transaction pooling does not support prepared statements
  });
}

export function getDb(): Database {
  if (!database) {
    client = createClient(getEnv().DATABASE_URL);
    database = drizzle(client, { schema, casing: 'snake_case' });
  }
  return database;
}

/** Closes the pool. Called by the worker's graceful-shutdown path (F2.3). */
export async function closeDb(): Promise<void> {
  if (client) {
    await client.end({ timeout: 5 });
    client = undefined;
    database = undefined;
  }
}

export { schema };
