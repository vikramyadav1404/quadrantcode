/**
 * The catalog grouped by topic, and the fixed problem number it lists by.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { listCatalogTopics, listTopicSections } from '@/server/services/problems';
import { compareTopics, topicLabel } from '@/lib/problems/topics';
import {
  type TestContext,
  createUser,
  hasTestDatabase,
  setupTestDb,
  truncateAll,
} from '../helpers/db';

const suite = hasTestDatabase ? describe : describe.skip;

const FLAG = 'FEATURE_ORIGINAL_PROBLEMS';

describe('topic labels and order (pure)', () => {
  it('labels the patterns by name and anything else from its slug', () => {
    expect(topicLabel('arrays-hashing')).toBe('Arrays & Hashing');
    expect(topicLabel('two-pointers')).toBe('Two Pointers');
    expect(topicLabel('dfs')).toBe('DFS');
  });

  it('puts the patterns first in their fixed order, then the rest by size', () => {
    const topics = [
      { topic: 'greedy', total: 900 },
      { topic: 'dynamic-programming', total: 400 },
      { topic: 'math', total: 1200 },
      { topic: 'arrays-hashing', total: 6 },
    ].sort(compareTopics);
    expect(topics.map((t) => t.topic)).toEqual([
      'arrays-hashing',
      'dynamic-programming',
      'math',
      'greedy',
    ]);
  });
});

suite('topic sections', () => {
  let ctx: TestContext;
  let previous: string | undefined;

  beforeAll(async () => {
    ctx = await setupTestDb();
  }, 60_000);

  afterAll(async () => {
    await ctx?.close();
  });

  beforeEach(async () => {
    previous = process.env[FLAG];
    process.env[FLAG] = 'true';
    await truncateAll(ctx.sql);

    // Inserted hard first, so number order and difficulty order disagree.
    await ctx.sql`
      INSERT INTO problems (slug, title, source_type, platform, external_url, difficulty, status)
      SELECT 'g-' || i, 'Greedy ' || i, 'external_link', 'codeforces',
             'https://codeforces.com/problemset/problem/' || i || '/A',
             (ARRAY['hard','medium','easy']::difficulty[])[1 + (i % 3)], 'published'
      FROM generate_series(1, 9) AS i
    `;
    await ctx.sql`
      INSERT INTO problems (slug, title, source_type, platform, external_url, difficulty, status)
      VALUES ('g-hidden', 'Greedy Hidden', 'external_link', 'codeforces',
              'https://codeforces.com/problemset/problem/999/A', 'easy', 'draft')
    `;
    await ctx.sql`
      INSERT INTO problems (slug, title, source_type, statement, difficulty, status)
      VALUES ('orig-two-sum', 'Pair Ledger', 'original', 'Our own statement.', 'easy', 'published')
    `;
    await ctx.sql`
      INSERT INTO problem_tags (problem_id, tag_type, tag_value)
      SELECT id, 'topic'::problem_tag_type, 'greedy' FROM problems WHERE slug LIKE 'g-%'
      UNION ALL
      SELECT id, 'topic'::problem_tag_type, 'math' FROM problems WHERE slug IN ('g-1', 'g-2')
      UNION ALL
      SELECT id, 'topic'::problem_tag_type, 'arrays-hashing' FROM problems WHERE slug = 'orig-two-sum'
      UNION ALL
      SELECT id, 'pattern'::problem_tag_type, 'not-a-topic' FROM problems WHERE slug = 'g-3'
    `;
  });

  afterEach(() => {
    if (previous === undefined) delete process.env[FLAG];
    else process.env[FLAG] = previous;
  });

  it('every problem has a unique number, and new rows take the next one', async () => {
    const rows = await ctx.sql<
      { number: number }[]
    >`SELECT number FROM problems ORDER BY number`;
    const numbers = rows.map((row) => row.number);
    expect(new Set(numbers).size).toBe(numbers.length);

    const [inserted] = await ctx.sql<{ number: number }[]>`
      INSERT INTO problems (slug, title, source_type, platform, external_url, difficulty, status)
      VALUES ('late', 'Late', 'external_link', 'leetcode', 'https://leetcode.com/problems/late/',
              'easy', 'published')
      RETURNING number
    `;
    expect(inserted!.number).toBeGreaterThan(Math.max(...numbers));
  });

  it('groups by topic with counts by difficulty, published rows only', async () => {
    const sections = await listTopicSections(ctx.db, { userId: null, perTopic: 5 });
    const greedy = sections.find((section) => section.topic === 'greedy')!;

    expect(greedy.total).toBe(9); // the draft is not counted
    expect([greedy.easy, greedy.medium, greedy.hard]).toEqual([3, 3, 3]);
    expect(sections.find((section) => section.topic === 'math')?.total).toBe(2);
    // Only topic tags make sections.
    expect(sections.some((section) => section.topic === 'not-a-topic')).toBe(false);
  });

  it('lists the first few of each topic, easiest first and then by number', async () => {
    const sections = await listTopicSections(ctx.db, { userId: null, perTopic: 5 });
    const greedy = sections.find((section) => section.topic === 'greedy')!;

    expect(greedy.problems).toHaveLength(5);
    const rank = { easy: 0, medium: 1, hard: 2 } as const;
    const keys = greedy.problems.map((p) => [rank[p.difficulty], p.number] as const);
    expect(keys).toEqual([...keys].sort((a, b) => a[0] - b[0] || a[1] - b[1]));
    expect(greedy.problems.slice(0, 3).every((p) => p.difficulty === 'easy')).toBe(true);
  });

  it('puts the patterns first', async () => {
    const sections = await listTopicSections(ctx.db, { userId: null });
    expect(sections.map((section) => section.topic)).toEqual([
      'arrays-hashing',
      'greedy',
      'math',
    ]);
  });

  it('shows the signed-in user’s status on a row', async () => {
    const user = await createUser(ctx.db);
    await ctx.sql`
      INSERT INTO user_problems (user_id, problem_id, status)
      SELECT ${user.id}, id, 'solved' FROM problems WHERE slug = 'orig-two-sum'
    `;
    const sections = await listTopicSections(ctx.db, { userId: user.id });
    const row = sections.find((s) => s.topic === 'arrays-hashing')!.problems[0]!;
    expect(row.userStatus).toBe('solved');
  });

  it('hides originals, in both the sections and the topic filter, while the flag is off', async () => {
    process.env[FLAG] = 'false';
    const sections = await listTopicSections(ctx.db, { userId: null });
    expect(sections.some((section) => section.topic === 'arrays-hashing')).toBe(false);

    const topics = await listCatalogTopics(ctx.db);
    expect(topics.map((entry) => entry.topic)).toEqual(['greedy', 'math']);
  });
});
