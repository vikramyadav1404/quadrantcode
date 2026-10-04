/**
 * The local test database: the embedded Postgres that `npm run test:db:start`
 * boots (`scripts/test-db.ts`). One definition, used by that script and as the
 * default `TEST_DATABASE_URL` for vitest and Playwright outside CI (#27).
 *
 * Not a secret: a throwaway instance on this machine, and the same credentials
 * CI's `postgres` service container uses.
 */
export const LOCAL_TEST_DB = {
  port: 55432,
  user: 'postgres',
  password: 'postgres',
  database: 'quadrantcode_test',
} as const;

export const LOCAL_TEST_DATABASE_URL = `postgresql://${LOCAL_TEST_DB.user}:${LOCAL_TEST_DB.password}@localhost:${LOCAL_TEST_DB.port}/${LOCAL_TEST_DB.database}`;

/**
 * Prepares `env` for a test process: an optional, git-ignored `.env.test` is
 * loaded first by the caller; then, outside CI only, an unset
 * TEST_DATABASE_URL defaults to the local instance.
 *
 * Not in CI, because there the variable must come from the job — a CI run that
 * silently fell back to a database that does not exist there would fail for a
 * confusing reason instead of the clear one `tests/helpers/db.ts` gives.
 */
export function applyLocalTestDefaults(
  env: Record<string, string | undefined> = process.env,
): void {
  if (!env['CI'] && !env['TEST_DATABASE_URL'])
    env['TEST_DATABASE_URL'] = LOCAL_TEST_DATABASE_URL;
}
