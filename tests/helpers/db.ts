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
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from '@/server/db/schema';

const MIGRATIONS_DIR = 'server/db/migrations';

export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
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

/** Drops and rebuilds the public schema, then migrates. Called once per suite. */
export async function setupTestDb(): Promise<TestContext> {
  if (!TEST_DATABASE_URL) throw new Error('TEST_DATABASE_URL is not set');

  const client = postgres(TEST_DATABASE_URL, { max: 1, onnotice: () => {} });
  await client.unsafe('DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;');
  await applyMigrations(client);

  return {
    db: drizzle(client, { schema, casing: 'snake_case' }),
    sql: client,
    close: () => client.end(),
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
