/**
 * F1.1 · cursor pagination and filtering.
 *
 * The acceptance criterion is "cursor pagination is stable across inserts (no
 * duplicate/skipped rows)". That is not provable by paging a static table —
 * every implementation passes that, including OFFSET. The test that matters
 * inserts rows BETWEEN page fetches and asserts the pages still partition the
 * original set.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { problems } from '@/server/db/schema';
import {
  InvalidCursorError,
  createProblem,
  decodeCursor,
  encodeCursor,
  listProblems,
  parseFilters,
} from '@/server/services/problems';
import {
  type TestContext,
  createUser,
  hasTestDatabase,
  setupTestDb,
  truncateAll,
} from '../helpers/db';

const suite = hasTestDatabase ? describe : describe.skip;

describe('F1.1 · cursor encoding (pure)', () => {
  it('round-trips', () => {
    const cursor = { difficulty: 'medium' as const, number: 4217 };
    expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor);
  });

  it('rejects a token issued before problem numbers existed', () => {
    // `created_at|id` was the key until migration 0028. The catalog page turns
    // this error into "start from the first page".
    const legacy = Buffer.from(
      '2026-08-13T10:11:12.345678Z|3f1c2b7a-9d4e-4c8b-8a1f-2e5d6c7b8a90',
    ).toString('base64url');
    expect(() => decodeCursor(legacy)).toThrow(InvalidCursorError);
  });

  it('rejects a tampered or malformed token with a typed error', () => {
    for (const bad of ['', 'not-base64!!', Buffer.from('no-separator').toString('base64url')]) {
      expect(() => decodeCursor(bad)).toThrow(InvalidCursorError);
    }

    for (const forged of [
      'trivial|12', // not a difficulty
      'easy|1; DROP TABLE problems', // not a number
      'easy|0', // numbers start at 1
      'easy|-3',
      'hard|12.5',
      'hard|9999999999', // past Postgres integer
    ]) {
      expect(() => decodeCursor(Buffer.from(forged).toString('base64url'))).toThrow(
        InvalidCursorError,
      );
    }
  });

  it('is opaque — the token does not read as its key', () => {
    const token = encodeCursor({ difficulty: 'medium', number: 4217 });
    expect(token).not.toContain('medium');
    expect(token).not.toContain('4217');
  });
});

suite('F1.1 · listing', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await setupTestDb();
  }, 60_000);

  afterAll(async () => {
    await ctx?.close();
  });

  beforeEach(async () => {
    await truncateAll(ctx.sql);
  });

  /** Inserts n published problems with strictly increasing created_at. */
  async function seed(n: number, prefix = 'p'): Promise<void> {
    await ctx.sql`
      INSERT INTO problems (slug, title, source_type, platform, external_url, difficulty, status, created_at)
      SELECT
        ${prefix} || '-' || i,
        'Problem ' || i,
        'external_link', 'leetcode',
        'https://leetcode.com/problems/' || ${prefix} || '-' || i || '/',
        (ARRAY['easy','medium','hard']::difficulty[])[1 + (i % 3)],
        'published',
        now() - (i || ' minutes')::interval
      FROM generate_series(1, ${n}) AS i
    `;
  }

  it('pages through every row exactly once', async () => {
    await seed(25);

    const seen: string[] = [];
    let cursor: string | undefined;

    for (let page = 0; page < 10; page += 1) {
      const result = await listProblems({
        db: ctx.db,
        filters: parseFilters({ limit: 10, cursor }),
      });
      seen.push(...result.rows.map((row) => row.slug));
      if (!result.nextCursor) break;
      cursor = result.nextCursor;
    }

    expect(seen).toHaveLength(25);
    expect(new Set(seen).size).toBe(25); // no duplicates
  });

  it('PAGES THROUGH A GROUP STAMPED IN ONE TRANSACTION without losing its tail', async () => {
    /*
     * A bulk import stamps every row with the same now(), microseconds and
     * all. Under the old `created_at` key a millisecond anchor skipped the
     * rest of such a group; production lost the sixteenth batch-1 original
     * this way on 2026-11-09. The key no longer involves the timestamp, and
     * this stays as the regression test for that loss.
     */
    await ctx.sql`
      INSERT INTO problems (slug, title, source_type, platform, external_url, difficulty, status, created_at)
      SELECT 'same-' || i, 'Same ' || i, 'external_link', 'leetcode',
             'https://leetcode.com/problems/same-' || i || '/', 'easy', 'published',
             '2026-11-09 05:58:38.141592+00'
      FROM generate_series(1, 13) AS i
    `;

    const seen: string[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 10; page += 1) {
      const result = await listProblems({
        db: ctx.db,
        filters: parseFilters({ limit: 5, cursor }),
      });
      seen.push(...result.rows.map((row) => row.slug));
      if (!result.nextCursor) break;
      cursor = result.nextCursor;
    }

    expect(seen).toHaveLength(13);
    expect(new Set(seen).size).toBe(13);
  });

  it('STAYS STABLE when rows are inserted between page fetches', async () => {
    await seed(20, 'orig');

    const first = await listProblems({ db: ctx.db, filters: parseFilters({ limit: 5 }) });
    expect(first.rows).toHaveLength(5);

    // Insert newer rows mid-pagination. With OFFSET these would shift the
    // window and cause a skipped row on the next page.
    await ctx.sql`
      INSERT INTO problems (slug, title, source_type, platform, external_url, difficulty, status, created_at)
      SELECT 'intruder-' || i, 'Intruder ' || i, 'external_link', 'leetcode',
             'https://leetcode.com/problems/intruder-' || i || '/', 'easy', 'published', now()
      FROM generate_series(1, 5) AS i
    `;

    const seen = [...first.rows.map((row) => row.slug)];
    let cursor = first.nextCursor ?? undefined;

    while (cursor) {
      const next = await listProblems({
        db: ctx.db,
        filters: parseFilters({ limit: 5, cursor }),
      });
      seen.push(...next.rows.map((row) => row.slug));
      cursor = next.nextCursor ?? undefined;
    }

    const originals = seen.filter((slug) => slug.startsWith('orig-'));
    expect(new Set(originals).size).toBe(20); // every original seen
    expect(originals).toHaveLength(20); // and none twice

    // The intruders are easy and take the next numbers, so they sort after the
    // first page's anchor and the continuing scan reaches each of them once.
    // Nothing already shown moved, which is what OFFSET would have got wrong.
    const intruders = seen.filter((slug) => slug.startsWith('intruder-'));
    expect(intruders).toHaveLength(5);
    expect(new Set(intruders).size).toBe(5);
  });

  it('lists easiest first, then by number', async () => {
    await seed(9);

    const result = await listProblems({ db: ctx.db, filters: parseFilters({ limit: 50 }) });
    const rank = { easy: 0, medium: 1, hard: 2 } as const;
    const keys = result.rows.map((row) => [rank[row.difficulty], row.number] as const);
    const sorted = [...keys].sort((a, b) => a[0] - b[0] || a[1] - b[1]);

    expect(keys).toEqual(sorted);
    expect(result.rows[0]?.difficulty).toBe('easy');
    expect(result.rows.at(-1)?.difficulty).toBe('hard');
  });

  it('returns a stable order when created_at ties', async () => {
    // A bulk import stamps many rows in the same instant. created_at alone is
    // not a valid keyset; the id tiebreak is what keeps the order total.
    await ctx.sql`
      INSERT INTO problems (slug, title, source_type, platform, external_url, difficulty, status, created_at)
      SELECT 'tied-' || i, 'Tied ' || i, 'external_link', 'leetcode',
             'https://leetcode.com/problems/tied-' || i || '/', 'medium', 'published',
             timestamptz '2026-01-01 00:00:00+00'
      FROM generate_series(1, 12) AS i
    `;

    const seen: string[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 6; page += 1) {
      const result = await listProblems({
        db: ctx.db,
        filters: parseFilters({ limit: 4, cursor }),
      });
      seen.push(...result.rows.map((row) => row.slug));
      if (!result.nextCursor) break;
      cursor = result.nextCursor;
    }

    expect(seen).toHaveLength(12);
    expect(new Set(seen).size).toBe(12);
  });

  it('the last page reports no next cursor', async () => {
    await seed(3);
    const result = await listProblems({ db: ctx.db, filters: parseFilters({ limit: 10 }) });

    expect(result.rows).toHaveLength(3);
    expect(result.nextCursor).toBeNull();
  });

  describe('filters', () => {
    it('filters by difficulty', async () => {
      await seed(30);
      const result = await listProblems({
        db: ctx.db,
        filters: parseFilters({ difficulty: 'hard', limit: 100 }),
      });

      expect(result.rows.length).toBeGreaterThan(0);
      expect(result.rows.every((row) => row.difficulty === 'hard')).toBe(true);
    });

    it('filters by topic tag without multiplying rows', async () => {
      const a = await createProblem(ctx.db, {
        slug: 'graph-one',
        title: 'Graph One',
        sourceType: 'external_link',
        platform: 'leetcode',
        externalUrl: 'https://leetcode.com/problems/graph-one/',
        difficulty: 'medium',
        estimatedMinutes: 30,
        status: 'published',
        // Three tags — a JOIN would return this problem three times.
        tags: [
          { tagType: 'topic', tagValue: 'graphs' },
          { tagType: 'topic', tagValue: 'matrix' },
          { tagType: 'pattern', tagValue: 'bfs' },
        ],
      });

      await createProblem(ctx.db, {
        slug: 'array-one',
        title: 'Array One',
        sourceType: 'external_link',
        platform: 'leetcode',
        externalUrl: 'https://leetcode.com/problems/array-one/',
        difficulty: 'easy',
        estimatedMinutes: 15,
        status: 'published',
        tags: [{ tagType: 'topic', tagValue: 'arrays' }],
      });

      const result = await listProblems({
        db: ctx.db,
        filters: parseFilters({ topic: 'graphs', limit: 50 }),
      });

      expect(result.rows).toHaveLength(1);
      expect(result.rows[0]?.id).toBe(a.id);
      expect(result.rows[0]?.tags).toHaveLength(3);
    });

    it('excludes archived problems from the public list by default', async () => {
      await seed(5);
      await ctx.sql`UPDATE problems SET status = 'archived' WHERE slug = 'p-1'`;

      const publicList = await listProblems({
        db: ctx.db,
        filters: parseFilters({ limit: 50 }),
      });
      expect(publicList.rows.map((row) => row.slug)).not.toContain('p-1');

      const adminList = await listProblems({
        db: ctx.db,
        filters: parseFilters({ limit: 50, includeHidden: true }),
      });
      expect(adminList.rows.map((row) => row.slug)).toContain('p-1');
    });

    it('filters by the user’s own solve status', async () => {
      await seed(4);
      const user = await createUser(ctx.db);
      const [target] = await ctx.db
        .select({ id: problems.id })
        .from(problems)
        .where(sql`slug = 'p-2'`);

      await ctx.sql`
        INSERT INTO user_problems (user_id, problem_id, status)
        VALUES (${user.id}, ${target!.id}, 'solved')
      `;

      const solved = await listProblems({
        db: ctx.db,
        filters: parseFilters({ userStatus: 'solved', limit: 50 }),
        userId: user.id,
      });
      expect(solved.rows).toHaveLength(1);
      expect(solved.rows[0]?.slug).toBe('p-2');
      expect(solved.rows[0]?.userStatus).toBe('solved');

      // Anonymous callers get an empty list rather than an unfiltered one —
      // silently dropping the filter would show a misleading page.
      const anonymous = await listProblems({
        db: ctx.db,
        filters: parseFilters({ userStatus: 'solved', limit: 50 }),
      });
      expect(anonymous.rows).toHaveLength(0);
    });
  });
});
