/**
 * F0.2 · seed correctness and index usage.
 *
 * Two distinct things are checked here, and the distinction matters:
 *
 *   - the REAL seed (scripts/seed.ts, 30 hand-checked problems with genuine
 *     platform URLs) is asserted for correctness and C1 compliance;
 *   - a SYNTHETIC fixture (tests/fixtures/perf-dataset.ts) pads the tables so
 *     EXPLAIN plans mean something. Every row it creates is fabricated and uses
 *     the RFC 2606 `.invalid` TLD, and it is never reachable by the app.
 *
 * The two never mix: assertions about the seed exclude synthetic rows by slug
 * prefix, and a dedicated test asserts no fabricated URL can masquerade as a
 * real platform link.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { problems } from '@/server/db/schema';
import { SEED_PROBLEMS } from '@/scripts/seed-problems';
import { seedProblems } from '@/scripts/seed';
import {
  EXCLUDE_SYNTHETIC,
  SYNTHETIC_SLUG_PREFIX,
  SYNTHETIC_URL_HOST,
  loadPerfDataset,
} from '../fixtures/perf-dataset';
import {
  type TestContext,
  createUser,
  hasTestDatabase,
  setupTestDb,
  truncateAll,
} from '../helpers/db';

const suite = hasTestDatabase ? describe : describe.skip;

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

    // 1. The real, hand-checked seed.
    await seedProblems(ctx.db as never);

    // 2. The synthetic padding, clearly separated.
    const user = await createUser(ctx.db);
    userId = user.id;
    await loadPerfDataset({ sql: ctx.sql, userId });
  }, 180_000);

  afterAll(async () => {
    await ctx?.close();
  });

  describe('seed', () => {
    it('inserts 30 external-link problems with tags', async () => {
      const seeded = await ctx.db
        .select({ slug: problems.slug })
        .from(problems)
        .where(sql.raw(EXCLUDE_SYNTHETIC));

      expect(seeded).toHaveLength(30);
      expect(SEED_PROBLEMS).toHaveLength(30);

      const tagged = await ctx.sql`
        SELECT p.slug, count(*) FILTER (WHERE t.tag_type = 'topic')   AS topics,
                                count(*) FILTER (WHERE t.tag_type = 'pattern') AS patterns
        FROM problems p JOIN problem_tags t ON t.problem_id = p.id
        WHERE p.slug NOT LIKE ${`${SYNTHETIC_SLUG_PREFIX}%`}
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
        .where(sql.raw(EXCLUDE_SYNTHETIC));

      for (const { url } of rows) {
        expect(url).toMatch(/^https:\/\/leetcode\.com\/problems\/[a-z0-9-]+\/$/);
      }
    });

    it('no fabricated URL can masquerade as a real platform link', async () => {
      // Synthetic rows use the RFC 2606 `.invalid` TLD, which can never be
      // registered or resolved. If a future fixture starts inventing
      // plausible-looking platform URLs, this fails — inventing links is a C1
      // violation even inside a test database.
      const impostors = await ctx.sql`
        SELECT slug, external_url FROM problems
        WHERE slug LIKE ${`${SYNTHETIC_SLUG_PREFIX}%`}
          AND external_url NOT LIKE ${`${SYNTHETIC_URL_HOST}%`}
      `;
      expect(impostors).toEqual([]);

      const leaked = await ctx.sql`
        SELECT count(*) AS n FROM problems
        WHERE slug LIKE ${`${SYNTHETIC_SLUG_PREFIX}%`}
          AND (external_url LIKE '%leetcode.com%'
            OR external_url LIKE '%codeforces.com%'
            OR external_url LIKE '%codechef.com%')
      `;
      expect(Number(leaked[0]!.n)).toBe(0);
    });

    it('the application seed contains ZERO synthetic rows', async () => {
      // scripts/seed.ts is the only path the app can reach. It must never
      // produce a fabricated row.
      const { SEED_PROBLEMS: seeds } = await import('@/scripts/seed-problems');
      for (const problem of seeds) {
        expect(problem.slug.startsWith(SYNTHETIC_SLUG_PREFIX)).toBe(false);
        expect(problem.externalUrl).not.toContain('.invalid');
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
