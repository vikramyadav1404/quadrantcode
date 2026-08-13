/**
 * F0.2 · seed correctness and index usage.
 *
 * On a 30-row table Postgres will correctly prefer a sequential scan — an
 * index scan there would be slower, and asserting one would prove nothing. So
 * these tests seed the 30 real problems (to check the seed itself) and then
 * pad the tables to a realistic size before running EXPLAIN, which is the only
 * way the plans mean anything.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { problems } from '@/server/db/schema';
import { SEED_PROBLEMS } from '@/scripts/seed-problems';
import { seedProblems } from '@/scripts/seed';
import {
  type TestContext,
  createUser,
  hasTestDatabase,
  setupTestDb,
  truncateAll,
} from '../helpers/db';

const suite = hasTestDatabase ? describe : describe.skip;

/**
 * Rows added beyond the real seed so the planner faces a realistic table.
 *
 * Size alone is not enough — SELECTIVITY decides the plan. With only five
 * topic values, any single topic matches ~20% of rows and a hash join over a
 * sequential scan is genuinely cheaper than an index. A real catalog has
 * dozens of topics, so each one is a small slice; TOPIC_VOCABULARY reproduces
 * that. Padding the table without fixing selectivity would have produced a
 * plan that says nothing about production.
 */
const SYNTHETIC_PROBLEMS = 50_000;
const SYNTHETIC_DAYS = 400;

const TOPIC_VOCABULARY = [
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
];

type PlanNode = { 'Node Type': string; Plans?: PlanNode[]; 'Relation Name'?: string };

function flattenPlan(node: PlanNode): PlanNode[] {
  return [node, ...(node.Plans ?? []).flatMap(flattenPlan)];
}

suite('F0.2 · seed and index usage', () => {
  let ctx: TestContext;
  let userId: string;

  beforeAll(async () => {
    ctx = await setupTestDb();
    await truncateAll(ctx.sql);

    // 1. The real seed.
    await seedProblems(ctx.db as never);

    // 2. Synthetic padding so EXPLAIN reflects production-shaped data.
    await ctx.sql`
      INSERT INTO problems (slug, title, source_type, platform, external_url, difficulty, status)
      SELECT
        'synthetic-' || i,
        'Synthetic Problem ' || i,
        'external_link',
        'leetcode',
        'https://leetcode.com/problems/synthetic-' || i || '/',
        (ARRAY['easy','medium','hard']::difficulty[])[1 + (i % 3)],
        'published'
      FROM generate_series(1, ${SYNTHETIC_PROBLEMS}) AS i
    `;
    // Three topic tags per problem, drawn from a realistic vocabulary so no
    // single topic dominates the table.
    await ctx.sql`
      INSERT INTO problem_tags (problem_id, tag_type, tag_value)
      SELECT p.id, 'topic', ${ctx.sql.array(TOPIC_VOCABULARY)}[1 + ((abs(hashtext(p.slug)) + k) % ${TOPIC_VOCABULARY.length})]
      FROM problems p, generate_series(0, 2) AS k
      WHERE p.slug LIKE 'synthetic-%'
      ON CONFLICT DO NOTHING
    `;

    const user = await createUser(ctx.db);
    userId = user.id;

    await ctx.sql`
      INSERT INTO user_problems (user_id, problem_id, status, last_attempted_at)
      SELECT
        ${userId}::uuid,
        id,
        (ARRAY['not_started','in_progress','solved','stuck','needs_revision']::user_problem_status[])[1 + (abs(hashtext(slug)) % 5)],
        now() - (abs(hashtext(slug)) % 200 || ' days')::interval
      FROM problems
    `;
    await ctx.sql`
      INSERT INTO daily_sessions (user_id, local_date, solved_count, revision_count, completed)
      SELECT ${userId}::uuid, (current_date - i), (i % 4), (i % 3), (i % 4) > 1
      FROM generate_series(0, ${SYNTHETIC_DAYS}) AS i
    `;
    await ctx.sql`
      INSERT INTO verification_methods (user_id, method, identifier, code_hash, expires_at, consumed_at)
      SELECT ${userId}::uuid, 'phone', '+91987654' || lpad(i::text, 4, '0'), 'hash', now() + interval '10 minutes',
             CASE WHEN i % 50 = 0 THEN NULL ELSE now() END
      FROM generate_series(1, 3000) AS i
    `;

    await ctx.sql`ANALYZE`;
  }, 120_000);

  afterAll(async () => {
    await ctx?.close();
  });

  describe('seed', () => {
    it('inserts 30 external-link problems with tags', async () => {
      const seeded = await ctx.db
        .select({ slug: problems.slug })
        .from(problems)
        .where(sql`slug NOT LIKE 'synthetic-%'`);

      expect(seeded).toHaveLength(30);
      expect(SEED_PROBLEMS).toHaveLength(30);

      const tagged = await ctx.sql`
        SELECT p.slug, count(*) FILTER (WHERE t.tag_type = 'topic')   AS topics,
                                count(*) FILTER (WHERE t.tag_type = 'pattern') AS patterns
        FROM problems p JOIN problem_tags t ON t.problem_id = p.id
        WHERE p.slug NOT LIKE 'synthetic-%'
        GROUP BY p.slug
      `;
      expect(tagged).toHaveLength(30);
      for (const row of tagged) {
        expect(Number(row.topics)).toBeGreaterThanOrEqual(1);
        expect(Number(row.patterns)).toBeGreaterThanOrEqual(1);
      }
    });

    it('stores metadata only — every seeded row is statement-free (C1)', async () => {
      const [row] = await ctx.sql`
        SELECT count(*) AS violations FROM problems
        WHERE source_type = 'external_link'
          AND (statement IS NOT NULL OR examples IS NOT NULL OR editorial IS NOT NULL
               OR input_format IS NOT NULL OR output_format IS NOT NULL
               OR constraints_text IS NOT NULL)
      `;
      expect(Number(row!.violations)).toBe(0);
    });

    it('every seeded row has a resolvable platform URL', async () => {
      const rows = await ctx.db
        .select({ url: problems.externalUrl })
        .from(problems)
        .where(sql`slug NOT LIKE 'synthetic-%'`);

      for (const { url } of rows) {
        expect(url).toMatch(/^https:\/\/leetcode\.com\/problems\/[a-z0-9-]+\/$/);
      }
    });

    it('is idempotent — re-running changes no row count', async () => {
      const before = await ctx.sql`SELECT count(*) AS n FROM problems`;
      const beforeTags = await ctx.sql`SELECT count(*) AS n FROM problem_tags`;

      await seedProblems(ctx.db as never);

      const after = await ctx.sql`SELECT count(*) AS n FROM problems`;
      const afterTags = await ctx.sql`SELECT count(*) AS n FROM problem_tags`;

      expect(after[0]!.n).toBe(before[0]!.n);
      expect(afterTags[0]!.n).toBe(beforeTags[0]!.n);
    });
  });

  describe('EXPLAIN — each documented index is actually used', () => {
    async function planFor(query: string, params: unknown[] = []): Promise<PlanNode[]> {
      const rows = await ctx.sql.unsafe(
        `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${query}`,
        params as never[],
      );
      // postgres.js returns the JSON plan under the "QUERY PLAN" key.
      const raw = rows[0]!['QUERY PLAN'] as [{ Plan: PlanNode }];
      return flattenPlan(raw[0]!.Plan);
    }

    function usesIndex(nodes: PlanNode[], indexNameFragment: string): boolean {
      return nodes.some(
        (node) =>
          node['Node Type'].includes('Index') &&
          JSON.stringify(node).includes(indexNameFragment),
      );
    }

    function scansSequentially(nodes: PlanNode[], relation: string): boolean {
      return nodes.some(
        (node) => node['Node Type'] === 'Seq Scan' && node['Relation Name'] === relation,
      );
    }

    it("a user's problems filtered by status → user_problems_user_status_idx", async () => {
      const nodes = await planFor(
        `SELECT * FROM user_problems WHERE user_id = $1 AND status = 'solved'
         ORDER BY last_attempted_at DESC NULLS LAST LIMIT 50`,
        [userId],
      );

      expect(usesIndex(nodes, 'user_problems_user_status_idx')).toBe(true);
      expect(scansSequentially(nodes, 'user_problems')).toBe(false);
    });

    it('problems filtered by difficulty + topic tag → problem_tags_type_value_idx', async () => {
      const nodes = await planFor(
        `SELECT p.* FROM problems p
         JOIN problem_tags t ON t.problem_id = p.id
         WHERE t.tag_type = 'topic' AND t.tag_value = 'graphs'
           AND p.difficulty = 'medium' AND p.status = 'published'
         LIMIT 50`,
      );

      expect(usesIndex(nodes, 'problem_tags_type_value_idx')).toBe(true);
      expect(scansSequentially(nodes, 'problem_tags')).toBe(false);
    });

    it("a user's daily_sessions for the last 90 days → daily_sessions_user_date_idx", async () => {
      const nodes = await planFor(
        `SELECT * FROM daily_sessions
         WHERE user_id = $1 AND local_date >= current_date - 90
         ORDER BY local_date DESC`,
        [userId],
      );

      expect(usesIndex(nodes, 'daily_sessions_user_date')).toBe(true);
      expect(scansSequentially(nodes, 'daily_sessions')).toBe(false);
    });

    it('an unconsumed verification code by (user_id, method) → verification_methods_active_idx', async () => {
      const nodes = await planFor(
        `SELECT * FROM verification_methods
         WHERE user_id = $1 AND method = 'phone' AND consumed_at IS NULL
         ORDER BY created_at DESC LIMIT 1`,
        [userId],
      );

      expect(usesIndex(nodes, 'verification_methods_active_idx')).toBe(true);
      expect(scansSequentially(nodes, 'verification_methods')).toBe(false);
    });
  });
});
