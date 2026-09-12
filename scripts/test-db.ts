/**
 * Local test-database control.
 *
 * Integration tests need a REAL Postgres — CHECK constraints, partial unique
 * indexes and EXPLAIN plans cannot be verified against a mock. This script
 * runs an embedded Postgres so `npm test` is self-contained on a machine with
 * neither Docker nor a system Postgres.
 *
 *   npx tsx scripts/test-db.ts start   # boot on port 55432, print the URL
 *   npx tsx scripts/test-db.ts stop
 *
 * CI uses the `services: postgres` container instead and just sets
 * TEST_DATABASE_URL; nothing below runs there.
 */
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';

const PORT = 55432;
const USER = 'postgres';
const PASSWORD = 'postgres';
const DATA_DIR = resolve('.tmp/pgdata');
export const TEST_DB_NAME = 'quadrantcode_test';
export const TEST_DATABASE_URL = `postgresql://${USER}:${PASSWORD}@localhost:${PORT}/${TEST_DB_NAME}`;

function instance(): EmbeddedPostgres {
  return new EmbeddedPostgres({
    databaseDir: DATA_DIR,
    user: USER,
    password: PASSWORD,
    port: PORT,
    persistent: true,
  });
}

async function start(): Promise<void> {
  mkdirSync('.tmp', { recursive: true });
  const pg = instance();

  try {
    await pg.initialise();
  } catch {
    // Already initialised — a second `initialise()` on an existing data
    // directory throws, which is the expected path on every run after the first.
  }

  await pg.start();

  try {
    await pg.createDatabase(TEST_DB_NAME);
  } catch {
    // Database already exists; tests truncate rather than recreate.
  }

  console.log(TEST_DATABASE_URL);
}

async function stop(): Promise<void> {
  await instance().stop();
  console.log('stopped');
}

const command = process.argv[2];
const action = command === 'stop' ? stop : start;

action().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
