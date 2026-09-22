/**
 * Migration runner. Uses the direct (non-pooled) connection because pgbouncer
 * transaction pooling cannot hold the advisory lock migrations rely on.
 *
 * Run with: npm run db:migrate
 */
import 'dotenv/config';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { requireDirectDatabaseUrl } from './direct-url';

async function main(): Promise<void> {
  const url = requireDirectDatabaseUrl(process.env, 'run migrations');

  const client = postgres(url, { max: 1 });
  try {
    await migrate(drizzle(client), { migrationsFolder: 'server/db/migrations' });
    console.log('migrations applied');
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  console.error('migration failed:', error);
  process.exit(1);
});
