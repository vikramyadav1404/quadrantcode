/**
 * F1.1 · full-text title search.
 *
 * Two criteria: results are sensibly ranked, and the query uses the GIN index.
 * The second is asserted from an EXPLAIN plan on a realistically-sized table —
 * on a handful of rows Postgres correctly prefers a sequential scan and an
 * index assertion would prove nothing (see docs/decisions.md D3).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { listProblems, parseFilters, searchProblems } from '@/server/services/problems';
import { SYNTHETIC_SLUG_PREFIX, loadPerfDataset } from '../fixtures/perf-dataset';
import {
  type TestContext,
  createUser,
  hasTestDatabase,
  setupTestDb,
  truncateAll,
} from '../helpers/db';

const suite = hasTestDatabase ? describe : describe.skip;

type PlanNode = { 'Node Type': string; Plans?: PlanNode[]; 'Index Name'?: string };

function flatten(node: PlanNode): PlanNode[] {
  return [node, ...(node.Plans ?? []).flatMap(flatten)];
}

suite('F1.1 · search', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await setupTestDb();
    await truncateAll(ctx.sql);

    await ctx.sql`
      INSERT INTO problems (slug, title, source_type, platform, external_url, difficulty, status)
      VALUES
        ('binary-search', 'Binary Search', 'external_link', 'leetcode', 'https://leetcode.com/problems/binary-search/', 'easy', 'published'),
        ('search-rotated', 'Search in Rotated Sorted Array', 'external_link', 'leetcode', 'https://leetcode.com/problems/search-in-rotated-sorted-array/', 'medium', 'published'),
        ('sort-colors', 'Sort Colors', 'external_link', 'leetcode', 'https://leetcode.com/problems/sort-colors/', 'medium', 'published'),
        ('merge-intervals', 'Merge Intervals', 'external_link', 'leetcode', 'https://leetcode.com/problems/merge-intervals/', 'medium', 'published'),
        ('hidden-search', 'Hidden Search Problem', 'external_link', 'leetcode', 'https://leetcode.com/problems/hidden-search/', 'easy', 'archived')
    `;
  }, 60_000);

  afterAll(async () => {
    await ctx?.close();
  });

  it('finds problems by a word in the title', async () => {
    const results = await searchProblems(ctx.db, 'binary search');
    const slugs = results.map((row) => row.slug);

    expect(slugs).toContain('binary-search');
    expect(slugs).not.toContain('merge-intervals');
  });

  it('ranks the closer title first', async () => {
    const results = await searchProblems(ctx.db, 'binary search');
    expect(results[0]?.slug).toBe('binary-search');
  });

  it('stems — "sorting" matches "Sorted" and "Sort"', async () => {
    const slugs = (await searchProblems(ctx.db, 'sorting')).map((row) => row.slug);
    // This is why the column uses the 'english' config rather than 'simple'.
    expect(slugs.length).toBeGreaterThan(0);
    expect(slugs).toEqual(expect.arrayContaining(['sort-colors']));
  });

  it('excludes archived problems from search', async () => {
    const slugs = (await searchProblems(ctx.db, 'hidden')).map((row) => row.slug);
    expect(slugs).not.toContain('hidden-search');
  });

  it('accepts human input without throwing on stray syntax', async () => {
    // websearch_to_tsquery tolerates quotes, minus signs and stray operators
    // that would make to_tsquery raise a syntax error at the user.
    for (const term of ['"binary search"', 'search -tree', 'binary | search', 'a & & b']) {
      await expect(searchProblems(ctx.db, term)).resolves.toBeDefined();
    }
  });

  it('search composes with the list filters', async () => {
    const result = await listProblems({
      db: ctx.db,
      filters: parseFilters({ search: 'search', difficulty: 'medium', limit: 50 }),
    });

    expect(result.rows.every((row) => row.difficulty === 'medium')).toBe(true);
    expect(result.rows.map((row) => row.slug)).toContain('search-rotated');
  });

  it('finds nothing for a term that appears nowhere', async () => {
    expect(await searchProblems(ctx.db, 'quantumcryptography')).toHaveLength(0);
  });

  describe('index usage at production scale', () => {
    it('uses the GIN index rather than scanning', async () => {
      const user = await createUser(ctx.db);
      await loadPerfDataset({ sql: ctx.sql, userId: user.id, problems: 20_000, days: 30 });

      /*
       * SELECTIVITY, not size, decides the plan — the same lesson as
       * docs/decisions.md D3. At 2% of rows matching, a seq scan with LIMIT 50
       * finds enough matches after reading ~2,500 rows and is genuinely the
       * cheaper plan; Postgres was right to pick it and the first version of
       * this test was wrong to assert otherwise.
       *
       * A real search term is rare. Tagging ~20 rows in 20,000 (0.1%) means a
       * seq scan must read the whole table to find them, which is when the GIN
       * index is actually the better choice.
       */
      await ctx.sql`
        UPDATE problems SET title = 'Synthetic Dijkstra Shortest Path ' || slug
        WHERE id IN (
          SELECT id FROM problems WHERE slug LIKE ${`${SYNTHETIC_SLUG_PREFIX}%`} LIMIT 20
        )
      `;
      await ctx.sql`ANALYZE problems`;

      const rows = await ctx.sql.unsafe(`
        EXPLAIN (ANALYZE, FORMAT JSON)
        SELECT id, slug, title FROM problems
        WHERE status = 'published'
          AND search_vector @@ websearch_to_tsquery('english', 'dijkstra')
        LIMIT 50
      `);

      const plan = (rows[0]!['QUERY PLAN'] as [{ Plan: PlanNode }])[0]!.Plan;
      const nodes = flatten(plan);

      const usesGin = nodes.some(
        (node) =>
          node['Node Type'].includes('Bitmap Index Scan') &&
          node['Index Name'] === 'problems_search_vector_idx',
      );
      const seqScans = nodes.filter((node) => node['Node Type'] === 'Seq Scan');

      expect(
        usesGin,
        `plan did not use the GIN index: ${JSON.stringify(nodes.map((n) => n['Node Type']))}`,
      ).toBe(true);
      expect(seqScans).toHaveLength(0);
    }, 180_000);
  });
});
