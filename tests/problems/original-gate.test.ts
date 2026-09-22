/**
 * F4.1 · `FEATURE_ORIGINAL_PROBLEMS` actually gates the catalog.
 *
 * The flag existed in `lib/flags.ts` marked "NOT wired" — declared, listed on
 * /admin/health as though it were a switch, and read by nothing. This asserts
 * it is now a switch.
 *
 * ## Why all three entry points are tested separately
 *
 * The catalog has three doors: list, search, and detail-by-slug. A gate on the
 * list alone passes a test that only checks the list, while the problem stays
 * findable by typing its title and openable by guessing its slug. Each door
 * gets its own assertion, in both flag states, so "hidden" means hidden.
 *
 * The flag is read through `process.env` at call time, so these tests set and
 * restore it around each case rather than stubbing the module.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  ProblemNotFoundError,
  getProblemBySlug,
  listProblems,
  parseFilters,
  searchProblems,
} from '@/server/services/problems';
import {
  type TestContext,
  createUser,
  hasTestDatabase,
  setupTestDb,
  truncateAll,
} from '../helpers/db';

const suite = hasTestDatabase ? describe : describe.skip;

const FLAG = 'FEATURE_ORIGINAL_PROBLEMS';

suite('F4.1 · the original-problems gate', () => {
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
    await truncateAll(ctx.sql);

    await ctx.sql`
      INSERT INTO problems (slug, title, source_type, platform, external_url, statement, difficulty, status)
      VALUES
        ('ext-binary-search', 'Binary Search', 'external_link', 'leetcode',
         'https://leetcode.com/problems/binary-search/', NULL, 'easy', 'published'),
        ('orig-interval-merge', 'Merging Intervals', 'original', NULL, NULL,
         'You are given a list of intervals.', 'medium', 'published')
    `;
  });

  afterEach(() => {
    if (previous === undefined) delete process.env[FLAG];
    else process.env[FLAG] = previous;
  });

  const list = () =>
    listProblems({ db: ctx.db, filters: parseFilters({ limit: 50 }) }).then((page) =>
      page.rows.map((row) => row.slug).sort(),
    );

  describe('flag OFF', () => {
    beforeEach(() => {
      process.env[FLAG] = 'false';
    });

    it('hides originals from the list', async () => {
      expect(await list()).toEqual(['ext-binary-search']);
    });

    it('hides originals from search', async () => {
      const hits = await searchProblems(ctx.db, 'merging intervals');
      expect(hits.map((hit) => hit.slug)).toEqual([]);
    });

    it('404s an original by slug, rather than 403-ing it', async () => {
      // A 403 would confirm the slug exists. Same reasoning as the draft rule.
      await expect(
        getProblemBySlug(ctx.db, 'orig-interval-merge', null),
      ).rejects.toBeInstanceOf(ProblemNotFoundError);
    });

    it('still serves the external problem by slug', async () => {
      const problem = await getProblemBySlug(ctx.db, 'ext-binary-search', null);
      expect(problem.slug).toBe('ext-binary-search');
    });

    it('keeps an original reachable for someone who already has history with it', async () => {
      // Turning the flag off is a catalog change, not a retroactive deletion of
      // anyone's work — the same promise archiving makes.
      const user = await createUser(ctx.db, { email: 'gate@example.test' });
      const [row] = await ctx.sql<{ id: string }[]>`
        SELECT id FROM problems WHERE slug = 'orig-interval-merge'
      `;
      await ctx.sql`
        INSERT INTO user_problems (user_id, problem_id, status)
        VALUES (${user.id}, ${row!.id}, 'solved')
      `;

      const problem = await getProblemBySlug(ctx.db, 'orig-interval-merge', user.id);
      expect(problem.slug).toBe('orig-interval-merge');
    });

    it('shows originals to an admin caller that opts in', async () => {
      const page = await listProblems({
        db: ctx.db,
        filters: parseFilters({ limit: 50, includeHidden: true }),
        includeOriginals: true,
      });
      expect(page.rows.map((row) => row.slug).sort()).toEqual([
        'ext-binary-search',
        'orig-interval-merge',
      ]);
    });
  });

  describe('flag ON', () => {
    beforeEach(() => {
      process.env[FLAG] = 'true';
    });

    it('lists originals alongside external links', async () => {
      expect(await list()).toEqual(['ext-binary-search', 'orig-interval-merge']);
    });

    it('finds originals in search', async () => {
      const hits = await searchProblems(ctx.db, 'merging intervals');
      expect(hits.map((hit) => hit.slug)).toContain('orig-interval-merge');
    });

    it('serves an original by slug to an anonymous visitor', async () => {
      const problem = await getProblemBySlug(ctx.db, 'orig-interval-merge', null);
      expect(problem.slug).toBe('orig-interval-merge');
      expect(problem.statement).toContain('list of intervals');
    });
  });

  describe('the gate is not vacuous', () => {
    it('the same fixtures differ between the two flag states', async () => {
      // If this ever reports the same set twice, every assertion above is
      // passing for a reason other than the flag.
      process.env[FLAG] = 'false';
      const off = await list();
      process.env[FLAG] = 'true';
      const on = await list();

      expect(off).not.toEqual(on);
      expect(on.length).toBe(off.length + 1);
    });

    it('an unset flag behaves as OFF, not as ON', async () => {
      // Flags default false so a forgotten variable hides a feature rather
      // than exposing it.
      delete process.env[FLAG];
      expect(await list()).toEqual(['ext-binary-search']);
    });

    it('only the exact truthy spellings enable it', async () => {
      for (const value of ['1', 'yes', 'TRUE ', 'on', '']) {
        process.env[FLAG] = value;
        expect(await list(), `value ${JSON.stringify(value)}`).toEqual(['ext-binary-search']);
      }
    });
  });
});
