/**
 * The catalog's source filter, and the default view that lists our own
 * problems before the links out (`listProblemsOriginalsFirst`).
 *
 * The paging test is the one that matters: the default view stitches two
 * listings together across a page boundary, which is exactly where a row gets
 * skipped or shown twice.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  listProblems,
  listProblemsOriginalsFirst,
  parseFilters,
} from '@/server/services/problems';
import { type TestContext, hasTestDatabase, setupTestDb, truncateAll } from '../helpers/db';

const suite = hasTestDatabase ? describe : describe.skip;
const FLAG = 'FEATURE_ORIGINAL_PROBLEMS';

suite('catalog · source filter and originals first', () => {
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
  });

  afterEach(() => {
    if (previous === undefined) delete process.env[FLAG];
    else process.env[FLAG] = previous;
  });

  /**
   * Externals are the NEWER rows, so a plain newest-first listing puts every
   * original last — the situation the default view exists to fix.
   */
  async function seed(originals: number, externals: number): Promise<void> {
    await ctx.sql`
      INSERT INTO problems (slug, title, source_type, statement, difficulty, status, created_at)
      SELECT 'orig-' || i, 'Original ' || i, 'original', 'Our own statement ' || i,
             'medium', 'published', now() - interval '1 day' - (i || ' minutes')::interval
      FROM generate_series(1, ${originals}) AS i
    `;
    await ctx.sql`
      INSERT INTO problems (slug, title, source_type, platform, external_url, difficulty, status, created_at)
      SELECT 'ext-' || i, 'External ' || i, 'external_link', 'leetcode',
             'https://leetcode.com/problems/ext-' || i || '/', 'easy', 'published',
             now() - (i || ' minutes')::interval
      FROM generate_series(1, ${externals}) AS i
    `;
  }

  async function pageAll(limit: number) {
    const seen: string[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 50; page += 1) {
      const result = await listProblemsOriginalsFirst({
        db: ctx.db,
        filters: parseFilters({ limit, cursor }),
      });
      seen.push(...result.rows.map((row) => row.slug));
      if (!result.nextCursor) return { seen, pages: page + 1 };
      cursor = result.nextCursor;
    }
    throw new Error('did not terminate');
  }

  it('source=original lists only ours, source=external only the links', async () => {
    await seed(3, 4);

    const ours = await listProblems({
      db: ctx.db,
      filters: parseFilters({ source: 'original' }),
    });
    const links = await listProblems({
      db: ctx.db,
      filters: parseFilters({ source: 'external' }),
    });

    expect(ours.rows.map((row) => row.sourceType)).toEqual(Array(3).fill('original'));
    expect(links.rows.map((row) => row.sourceType)).toEqual(Array(4).fill('external_link'));
  });

  it('a blank source means both, and an unknown one is rejected', () => {
    expect(parseFilters({ source: '' }).source).toBeUndefined();
    expect(() => parseFilters({ source: 'leetcode' })).toThrow();
  });

  it('DEFAULT VIEW: originals first, then the links, each newest first', async () => {
    await seed(3, 4);

    const { seen } = await pageAll(25);

    expect(seen).toEqual(['orig-1', 'orig-2', 'orig-3', 'ext-1', 'ext-2', 'ext-3', 'ext-4']);
  });

  it('PAGES ACROSS THE SEAM with no row skipped or repeated', async () => {
    // 7 originals, 11 links, pages of 5: the seam falls inside page 2.
    await seed(7, 11);

    const { seen, pages } = await pageAll(5);

    expect(seen).toHaveLength(18);
    expect(new Set(seen).size).toBe(18);
    expect(seen.slice(0, 7).every((slug) => slug.startsWith('orig-'))).toBe(true);
    expect(pages).toBe(4); // 5 + 5 + 5 + 3: no short page before the last
  });

  it('a page that ends exactly on the last original still leads to the links', async () => {
    await seed(5, 2);

    const first = await listProblemsOriginalsFirst({
      db: ctx.db,
      filters: parseFilters({ limit: 5 }),
    });
    expect(first.rows.every((row) => row.sourceType === 'original')).toBe(true);
    expect(first.nextCursor).toBe('e.');

    const { seen } = await pageAll(5);
    expect(seen).toEqual(['orig-1', 'orig-2', 'orig-3', 'orig-4', 'orig-5', 'ext-1', 'ext-2']);
  });

  it('no links at all: the last page of originals has no next page', async () => {
    await seed(5, 0);

    const first = await listProblemsOriginalsFirst({
      db: ctx.db,
      filters: parseFilters({ limit: 5 }),
    });
    expect(first.nextCursor).toBeNull();
  });

  it('with originals switched off, the default view is just the links', async () => {
    process.env[FLAG] = 'false';
    await seed(3, 4);

    const { seen } = await pageAll(25);
    expect(seen).toEqual(['ext-1', 'ext-2', 'ext-3', 'ext-4']);
  });

  it('a chosen source keeps the plain order and plain cursors', async () => {
    await seed(2, 7);

    const page = await listProblemsOriginalsFirst({
      db: ctx.db,
      filters: parseFilters({ limit: 5, source: 'external' }),
    });
    expect(page.rows.map((row) => row.slug)).toEqual([
      'ext-1',
      'ext-2',
      'ext-3',
      'ext-4',
      'ext-5',
    ]);
    expect(page.nextCursor).not.toMatch(/^[oe]\./);
  });

  it('a bare cursor from before still pages the plain listing', async () => {
    await seed(2, 7);

    const plain = await listProblems({ db: ctx.db, filters: parseFilters({ limit: 3 }) });
    const next = await listProblemsOriginalsFirst({
      db: ctx.db,
      filters: parseFilters({ limit: 3, cursor: plain.nextCursor! }),
    });
    const direct = await listProblems({
      db: ctx.db,
      filters: parseFilters({ limit: 3, cursor: plain.nextCursor! }),
    });
    expect(next.rows.map((row) => row.slug)).toEqual(direct.rows.map((row) => row.slug));
  });
});
