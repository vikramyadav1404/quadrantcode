/**
 * Integration-test database harness.
 *
 * Constraint behaviour (CHECK, partial unique indexes, triggers) and query
 * plans cannot be verified against a mock, so these tests talk to a real
 * Postgres. Point TEST_DATABASE_URL at one:
 *
 *   npx tsx scripts/test-db.ts start     # embedded Postgres on :55432
 *   TEST_DATABASE_URL=... npm test
 *
 * When TEST_DATABASE_URL is absent the suites skip themselves rather than
 * fail, so `npm test` stays green on a machine without a database. CI sets it
 * from the `postgres` service container.
 *
 * **In CI that skip is refused.** Skipping locally is a convenience; skipping in
 * CI is a green build that verified none of the constraints, triggers, leases or
 * query plans it claims to cover — the single most expensive way for this suite
 * to lie. `.github/workflows/ci.yml` sets the variable at job level today, and
 * the guard below is what makes its removal a loud failure instead of a silent
 * drop in coverage.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from '@/server/db/schema';

const MIGRATIONS_DIR = 'server/db/migrations';

/**
 * Advisory-lock key identifying "the Quadrantcode test database".
 *
 * Arbitrary but fixed: every run must choose the same number or the lock
 * guards nothing. Advisory locks live in their own namespace and collide with
 * no table, row or application lock.
 */
const TEST_DB_LOCK_KEY = 415_523_198;

export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

if (process.env.CI && !TEST_DATABASE_URL) {
  throw new Error(
    'TEST_DATABASE_URL is not set, but CI is. The database suites must RUN in CI, ' +
      'not skip: see the `postgres` service and the job-level TEST_DATABASE_URL in ' +
      '.github/workflows/ci.yml. Set the variable or remove the suites deliberately — ' +
      'a green run that skipped them proves nothing about constraints, leases or plans.',
  );
}

export const hasTestDatabase = Boolean(TEST_DATABASE_URL);

export type TestDb = ReturnType<typeof drizzle<typeof schema>>;

export type TestContext = {
  db: TestDb;
  sql: ReturnType<typeof postgres>;
  close: () => Promise<void>;
};

/** Applies every up-migration in order, splitting on drizzle's breakpoint marker. */
export async function applyMigrations(client: ReturnType<typeof postgres>): Promise<void> {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith('.sql'))
    .sort();

  for (const file of files) {
    const contents = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    for (const statement of contents.split('--> statement-breakpoint')) {
      const trimmed = statement.trim();
      if (trimmed.length > 0) await client.unsafe(trimmed);
    }
  }
}

/**
 * Drops and rebuilds the public schema, then migrates. Called once per suite.
 *
 * `max` is the connection-pool size and defaults to 1, which is right for the
 * suites that assert on schema behaviour: one connection makes ordering
 * deterministic and avoids fixtures racing each other.
 *
 * **A test asserting CONCURRENCY must raise it.** With `max: 1` the driver
 * serialises every query onto a single connection, so `Promise.all` over N
 * claims is N sequential statements wearing a concurrent costume — it exercises
 * repetition, not contention, and an atomic-claim test written that way passes
 * without ever racing anything. Pass a pool large enough for the callers to
 * collide, and let Postgres arbitrate.
 */
export async function setupTestDb({ max = 1 }: { max?: number } = {}): Promise<TestContext> {
  if (!TEST_DATABASE_URL) throw new Error('TEST_DATABASE_URL is not set');

  /*
   * The rebuild runs on its OWN single connection, and that is not tidiness.
   *
   * `DROP SCHEMA public CASCADE` invalidates every object a session has already
   * resolved. Issued through a pool, the drop and the migrations that follow
   * land on different backends, and a backend that connected against the old
   * schema keeps resolving to it — the suite then fails partway through with
   * `relation "users" does not exist`, on a database whose tables plainly do.
   * Migrating on one connection and closing it means every pooled connection
   * below is opened after the schema exists.
   */
  const migrator = postgres(TEST_DATABASE_URL, { max: 1, onnotice: () => {} });

  /*
   * One test run at a time, enforced by the database itself.
   *
   * Two runs against the same database wreck each other: the second one's
   * DROP SCHEMA deletes the tables the first one is midway through using, and
   * the first fails with `relation "users" does not exist` on a database whose
   * tables plainly exist. That reads as a code fault and is not one — it cost
   * an hour of this ticket before the cause was spotted.
   *
   * The lock is session-scoped and held by this connection for the life of the
   * suite, so a competing run is refused at setup with the message below
   * instead of corrupting both runs. `pg_try_advisory_lock` returns rather than
   * waits: blocking here would just hang the second run until a timeout.
   */
  const [lock] = await migrator`select pg_try_advisory_lock(${TEST_DB_LOCK_KEY}) as locked`;
  if (!lock?.locked) {
    await migrator.end();
    throw new Error(
      'Another test run already holds this database. Two runs against the same ' +
        `Postgres destroy each other's schema mid-test. Wait for the other run to ` +
        'finish, or point TEST_DATABASE_URL at a different database.',
    );
  }

  try {
    await migrator.unsafe('DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;');
    await applyMigrations(migrator);
  } catch (error) {
    await migrator.end();
    throw error;
  }

  const client = postgres(TEST_DATABASE_URL, { max, onnotice: () => {} });

  return {
    db: drizzle(client, { schema, casing: 'snake_case' }),
    sql: client,
    close: async () => {
      await client.end();
      // Ends the session, which releases the advisory lock with it.
      await migrator.end();
    },
  };
}

/** Empties every data table between tests without re-running migrations. */
export async function truncateAll(client: ReturnType<typeof postgres>): Promise<void> {
  /*
   * TRUNCATE, not DELETE — and for `audit_logs` and `session_events` that is not
   * a style choice. Both refuse row-level DELETE by trigger (F4.6, F3.2), and
   * TRUNCATE does not fire row-level triggers, so it is the only way a test
   * fixture can reset them.
   *
   * Which also names a real gap: an operator with TRUNCATE can erase the audit
   * trail. The application cannot, which is what the trigger is for; a
   * least-privilege database role is what would close the rest, and F4.8's
   * infrastructure section owns that.
   */
  await client.unsafe(`
    TRUNCATE TABLE
      audit_logs,
      moderation_decisions, interview_report_questions, interview_reports,
      assessment_answers, assessment_attempts, assessment_paper_questions, assessment_papers,
      problem_company_evidence, companies,
      editorials, problem_language_templates, test_cases, problem_examples,
      problem_topics, topics, problem_versions, content_licenses,
      auth_verification_tokens, auth_sessions, auth_accounts,
      daily_sessions, daily_goals, user_problems,
      problem_tags, problems,
      verification_methods, user_profiles, users
    RESTART IDENTITY CASCADE
  `);
}

/**
 * Postgres error surfaced by a failed query.
 *
 * Drizzle wraps driver errors in a `DrizzleQueryError` whose `message` is only
 * "Failed query: ...". The interesting fields — SQLSTATE and the violated
 * constraint's name — live on `cause`, so asserting on the wrapper would let a
 * query that failed for the *wrong* reason pass the test.
 */
export type PgError = {
  code?: string;
  constraint_name?: string;
  message: string;
};

export function pgErrorOf(error: unknown): PgError {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current instanceof Error; depth += 1) {
    const candidate = current as Error & { code?: string; constraint_name?: string };
    if (candidate.code ?? candidate.constraint_name) {
      return {
        code: candidate.code,
        constraint_name: candidate.constraint_name,
        message: candidate.message,
      };
    }
    current = candidate.cause;
  }
  return { message: error instanceof Error ? error.message : String(error) };
}

/**
 * Asserts a query fails with a specific database constraint or error text.
 * Returns the parsed error so a caller can make further assertions.
 */
export async function expectDbRejection(
  operation: Promise<unknown> | (() => Promise<unknown>),
  matcher: string | RegExp,
): Promise<PgError> {
  const promise = typeof operation === 'function' ? operation() : operation;

  let caught: unknown;
  try {
    await promise;
  } catch (error) {
    caught = error;
  }

  if (caught === undefined) {
    throw new Error(
      `Expected the query to be rejected by ${String(matcher)}, but it succeeded.`,
    );
  }

  const pgError = pgErrorOf(caught);
  const haystack = `${pgError.constraint_name ?? ''} ${pgError.message}`;
  const matches =
    typeof matcher === 'string' ? haystack.includes(matcher) : matcher.test(haystack);

  if (!matches) {
    throw new Error(
      `Expected rejection matching ${String(matcher)}, got ` +
        `constraint=${pgError.constraint_name ?? '(none)'} code=${pgError.code ?? '(none)'} ` +
        `message=${pgError.message}`,
    );
  }

  return pgError;
}

/** Inserts a user with sensible defaults; overrides win. */
export async function createUser(
  db: TestDb,
  overrides: Partial<typeof schema.users.$inferInsert> = {},
): Promise<typeof schema.users.$inferSelect> {
  const suffix = Math.random().toString(36).slice(2, 10);
  const [row] = await db
    .insert(schema.users)
    .values({ email: `user-${suffix}@example.com`, ...overrides })
    .returning();

  if (!row) throw new Error('createUser inserted no row');
  return row;
}
