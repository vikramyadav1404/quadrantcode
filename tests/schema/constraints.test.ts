/**
 * F0.2 acceptance criteria, verified against a real Postgres.
 *
 * These assert DATABASE behaviour, not service behaviour: every one of them
 * must hold even if a service module is bypassed entirely. Assertions check
 * the violated constraint by NAME (via `expectDbRejection`), so a query that
 * fails for an unrelated reason cannot make the test pass.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { problemTags, problems, userProblems, users } from '@/server/db/schema';
import {
  type TestContext,
  createUser,
  expectDbRejection,
  hasTestDatabase,
  setupTestDb,
  truncateAll,
} from '../helpers/db';

const suite = hasTestDatabase ? describe : describe.skip;

suite('F0.2 · database constraints', () => {
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

  const externalLink = {
    slug: 'sample-external',
    title: 'Sample External Problem',
    sourceType: 'external_link' as const,
    platform: 'leetcode',
    externalUrl: 'https://leetcode.com/problems/sample-external/',
    difficulty: 'medium' as const,
  };

  describe('C1 — external-link problems carry no statement text', () => {
    it('accepts a metadata-only external-link problem', async () => {
      const [row] = await ctx.db.insert(problems).values(externalLink).returning();
      expect(row?.statement).toBeNull();
      expect(row?.externalUrl).toBe(externalLink.externalUrl);
    });

    it('REJECTS an external-link problem carrying a statement body', async () => {
      const error = await expectDbRejection(
        ctx.db.insert(problems).values({
          ...externalLink,
          statement: 'Given an array of integers, return indices of two numbers...',
        }),
        'problems_external_link_no_statement',
      );

      // 23514 = check_violation. Proves the DATABASE rejected it, not the ORM.
      expect(error.code).toBe('23514');
    });

    it.each([
      ['input_format', { inputFormat: 'First line contains n' }],
      ['output_format', { outputFormat: 'Print a single integer' }],
      ['constraints_text', { constraintsText: '1 <= n <= 1e5' }],
      ['editorial', { editorial: 'Use a hash map.' }],
      ['examples', { examples: [{ input: '1 2', output: '3' }] }],
    ])('REJECTS an external-link problem carrying %s', async (_label, extra) => {
      await expectDbRejection(
        ctx.db.insert(problems).values({ ...externalLink, ...extra }),
        'problems_external_link_no_statement',
      );
    });

    it('REJECTS an external-link problem with no external_url', async () => {
      await expectDbRejection(
        ctx.db.insert(problems).values({ ...externalLink, externalUrl: null }),
        'problems_external_link_no_statement',
      );
    });

    it('allows an original problem to carry a statement', async () => {
      const [row] = await ctx.db
        .insert(problems)
        .values({
          slug: 'rolling-trade-volume',
          title: 'Rolling Trade Volume',
          sourceType: 'original',
          difficulty: 'medium',
          statement: 'Our own original statement text.',
        })
        .returning();

      expect(row?.statement).toBe('Our own original statement text.');
    });
  });

  describe('C3 — company tags are always "-style"', () => {
    it('rejects a bare company tag and accepts the -style form', async () => {
      const [problem] = await ctx.db.insert(problems).values(externalLink).returning();
      const problemId = problem!.id;

      await expectDbRejection(
        ctx.db
          .insert(problemTags)
          .values({ problemId, tagType: 'company_style', tagValue: 'google' }),
        'problem_tags_company_style_suffix',
      );

      await expect(
        ctx.db
          .insert(problemTags)
          .values({ problemId, tagType: 'company_style', tagValue: 'faang-style' }),
      ).resolves.toBeDefined();
    });
  });

  describe('uniqueness', () => {
    it('rejects a duplicate (user_id, problem_id)', async () => {
      const user = await createUser(ctx.db);
      const [problem] = await ctx.db.insert(problems).values(externalLink).returning();

      await ctx.db.insert(userProblems).values({ userId: user.id, problemId: problem!.id });

      const error = await expectDbRejection(
        ctx.db.insert(userProblems).values({ userId: user.id, problemId: problem!.id }),
        'user_problems_user_problem_key',
      );
      expect(error.code).toBe('23505'); // unique_violation
    });

    it('lets many users hold a NULL phone but not share a real one', async () => {
      await createUser(ctx.db, { email: 'a@example.com', phoneNumber: null });
      await createUser(ctx.db, { email: 'b@example.com', phoneNumber: null });

      const rows = await ctx.db.select().from(users);
      expect(rows.filter((row) => row.phoneNumber === null)).toHaveLength(2);

      await createUser(ctx.db, { email: 'c@example.com', phoneNumber: '+919876543210' });
      await expectDbRejection(
        createUser(ctx.db, { email: 'd@example.com', phoneNumber: '+919876543210' }),
        'users_phone_number_key',
      );
    });

    it('rejects a duplicate problem slug', async () => {
      await ctx.db.insert(problems).values(externalLink);
      await expectDbRejection(
        ctx.db.insert(problems).values(externalLink),
        'problems_slug_key',
      );
    });
  });

  describe('users.timezone is a validated IANA identifier', () => {
    it('accepts a real zone', async () => {
      const user = await createUser(ctx.db, { timezone: 'America/New_York' });
      expect(user.timezone).toBe('America/New_York');
    });

    it('rejects a made-up zone on insert', async () => {
      await expectDbRejection(
        createUser(ctx.db, { timezone: 'Mars/Olympus_Mons' }),
        /invalid IANA timezone/,
      );
    });

    it('rejects an abbreviation like "IST" on update', async () => {
      const user = await createUser(ctx.db);
      await expectDbRejection(
        ctx.sql`UPDATE users SET timezone = 'IST' WHERE id = ${user.id}`,
        /invalid IANA timezone/,
      );
    });
  });

  describe('verification_level stays within its documented range', () => {
    it('rejects a level outside 0..2', async () => {
      await expectDbRejection(
        createUser(ctx.db, { verificationLevel: 3 }),
        'users_verification_level_range',
      );
    });
  });

  describe('updated_at is maintained by the database', () => {
    it('advances on UPDATE without the caller setting it', async () => {
      const user = await createUser(ctx.db);
      await new Promise((resolve) => setTimeout(resolve, 15));
      const [updated] = await ctx.sql`
        UPDATE users SET role = 'admin' WHERE id = ${user.id} RETURNING updated_at
      `;

      expect(new Date(updated!.updated_at).getTime()).toBeGreaterThan(user.updatedAt.getTime());
    });
  });
});
