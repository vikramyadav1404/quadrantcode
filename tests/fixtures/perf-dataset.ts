/**
 * SYNTHETIC performance fixture — test-only. NOT seed data.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * EVERY ROW THIS FILE CREATES IS FABRICATED. The URLs are not real problems and
 * are not meant to resolve: they use the `.invalid` TLD, which RFC 2606 §2
 * reserves precisely so it can never be registered or resolved. Nothing here
 * may ever be presented to a user as a link to follow.
 *
 * Why it is separate from `scripts/seed.ts`:
 *   - `scripts/seed.ts` is the APPLICATION seed. It contains 30 hand-checked
 *     real problems and is reachable by `npm run db:seed`.
 *   - this file lives under `tests/` and is imported only by
 *     `tests/schema/indexes.test.ts`. It is not exported from any application
 *     module, has no npm script, and cannot be run against a non-test database
 *     — `loadPerfDataset` refuses any connection string that is not the
 *     configured TEST_DATABASE_URL.
 *
 * Why fabricated rows exist at all: EXPLAIN plans are decided by selectivity,
 * not row count. On the 30-row real catalog Postgres correctly prefers a
 * sequential scan, so an index assertion there would prove nothing about
 * production. Padding to a production-shaped table is the only way the plans in
 * docs/performance.md mean anything.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import type postgres from 'postgres';

/** Marks every fabricated row so tests and queries can exclude them. */
export const SYNTHETIC_SLUG_PREFIX = 'zz-synthetic-';

/**
 * Reserved by RFC 2606 — guaranteed never to resolve, so a fabricated row can
 * never be mistaken for, or accidentally used as, a real problem link.
 */
export const SYNTHETIC_URL_HOST = 'https://perf-fixture.invalid';

export const SYNTHETIC_PROBLEM_COUNT = 50_000;
export const SYNTHETIC_DAY_COUNT = 400;
export const SYNTHETIC_OTP_COUNT = 3_000;

/**
 * A realistic topic vocabulary. Size alone would not change the plan — with
 * five topics any one matches ~20% of rows and a hash join genuinely wins. Real
 * catalogues carry dozens of topics, making each a small slice.
 */
export const TOPIC_VOCABULARY = [
  'arrays',
  'strings',
  'hashing',
  'two-pointers',
  'sliding-window',
  'binary-search',
  'sorting',
  'prefix-sum',
  'stack',
  'queue',
  'linked-list',
  'trees',
  'binary-search-tree',
  'heap',
  'trie',
  'graphs',
  'union-find',
  'topological-sort',
  'shortest-path',
  'matrix',
  'backtracking',
  'recursion',
  'dynamic-programming',
  'greedy',
  'intervals',
  'bit-manipulation',
  'math',
  'combinatorics',
  'probability',
  'geometry',
  'design',
  'simulation',
  'game-theory',
  'segment-tree',
  'fenwick-tree',
  'string-matching',
  'streaming',
  'order-statistics',
  'number-theory',
  'randomised',
] as const;

export type PerfDatasetOptions = {
  sql: ReturnType<typeof postgres>;
  userId: string;
  problems?: number;
  days?: number;
};

/**
 * Loads the synthetic dataset.
 *
 * Refuses to run unless the caller passes a connection created from
 * TEST_DATABASE_URL — a guard against someone importing this from a script and
 * pointing it at a real database.
 */
export async function loadPerfDataset({
  sql,
  userId,
  problems = SYNTHETIC_PROBLEM_COUNT,
  days = SYNTHETIC_DAY_COUNT,
}: PerfDatasetOptions): Promise<void> {
  if (!process.env.TEST_DATABASE_URL) {
    throw new Error(
      'loadPerfDataset requires TEST_DATABASE_URL. This fixture fabricates rows ' +
        'and must never touch a development or production database.',
    );
  }

  await sql`
    INSERT INTO problems (slug, title, source_type, platform, external_url, difficulty, status)
    SELECT
      ${SYNTHETIC_SLUG_PREFIX} || i,
      'Synthetic Fixture Problem ' || i,
      'external_link',
      'synthetic-fixture',
      ${`${SYNTHETIC_URL_HOST}/problem/`} || i,
      (ARRAY['easy','medium','hard']::difficulty[])[1 + (i % 3)],
      'published'
    FROM generate_series(1, ${problems}) AS i
  `;

  await sql`
    INSERT INTO problem_tags (problem_id, tag_type, tag_value)
    SELECT
      p.id,
      'topic',
      ${sql.array([...TOPIC_VOCABULARY])}[1 + ((abs(hashtext(p.slug)) + k) % ${TOPIC_VOCABULARY.length})]
    FROM problems p, generate_series(0, 2) AS k
    WHERE p.slug LIKE ${`${SYNTHETIC_SLUG_PREFIX}%`}
    ON CONFLICT DO NOTHING
  `;

  await sql`
    INSERT INTO user_problems (user_id, problem_id, status, last_attempted_at)
    SELECT
      ${userId}::uuid,
      id,
      (ARRAY['not_started','in_progress','solved','stuck','needs_revision']::user_problem_status[])[1 + (abs(hashtext(slug)) % 5)],
      now() - (abs(hashtext(slug)) % 200 || ' days')::interval
    FROM problems
  `;

  await sql`
    INSERT INTO daily_sessions (user_id, local_date, solved_count, revision_count, completed)
    SELECT ${userId}::uuid, (current_date - i), (i % 4), (i % 3), (i % 4) > 1
    FROM generate_series(0, ${days}) AS i
  `;

  await sql`
    INSERT INTO verification_methods (user_id, method, identifier, code_hash, expires_at, consumed_at)
    SELECT
      ${userId}::uuid, 'phone',
      '+99900' || lpad(i::text, 5, '0'),
      'synthetic-not-a-real-hash',
      now() + interval '10 minutes',
      CASE WHEN i % 50 = 0 THEN NULL ELSE now() END
    FROM generate_series(1, ${SYNTHETIC_OTP_COUNT}) AS i
  `;

  // Without fresh statistics the planner works from defaults and the measured
  // plans would not reflect the data actually present.
  await sql`ANALYZE`;
}

/** SQL fragment excluding fabricated rows, for assertions about real seed data. */
export const EXCLUDE_SYNTHETIC = `slug NOT LIKE '${SYNTHETIC_SLUG_PREFIX}%'`;
