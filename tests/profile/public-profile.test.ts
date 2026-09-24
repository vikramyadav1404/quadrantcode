/**
 * F4.7 · public profiles against a real database.
 *
 * The acceptance criteria this file carries: a new account's profile is OFF;
 * with it ON, code, notes, mistakes and reflections are absent from what the
 * public surface can render; and each section is absent when its toggle is.
 * The browser-level payload check lives in `e2e/public-profile.spec.ts`.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import {
  codeSnapshots,
  problemTags,
  problems,
  reflections,
  userProfiles,
  users,
} from '@/server/db/schema';
import { handleSchema } from '@/lib/profile/handle';
import {
  HandleTakenError,
  PublicProfileNeedsHandleError,
  getMonthlyCard,
  getProfile,
  getPublicProfile,
  updateProfile,
} from '@/server/services/profile';
import { markStuck } from '@/server/services/reflection';
import { completeSession, startSession } from '@/server/services/session';
import {
  type TestContext,
  createUser,
  expectDbRejection,
  hasTestDatabase,
  setupTestDb,
  truncateAll,
} from '../helpers/db';

const suite = hasTestDatabase ? describe : describe.skip;

const TIME_ZONE = 'Asia/Kolkata';
const START = new Date('2026-09-10T06:00:00.000Z');
const NOW = new Date('2026-09-10T12:00:00.000Z');
const EMAIL = 'public-owner@example.com';

const base = {
  displayName: 'Asha Rao',
  timezone: TIME_ZONE,
  bio: 'SECRET-BIO not in disclosure',
};

suite('F4.7 · public profiles', () => {
  let ctx: TestContext;
  let userId: string;
  let counter = 0;

  beforeAll(async () => {
    ctx = await setupTestDb();
  }, 60_000);

  afterAll(async () => {
    await ctx?.close();
  });

  beforeEach(async () => {
    await truncateAll(ctx.sql);
    userId = (await createUser(ctx.db, { email: EMAIL, timezone: TIME_ZONE })).id;
    counter = 0;
  });

  async function makeProblem(topic: string) {
    counter += 1;
    const slug = `pub-${counter}`;
    const [problem] = await ctx.db
      .insert(problems)
      .values({
        slug,
        title: `Public ${counter}`,
        sourceType: 'external_link',
        platform: 'leetcode',
        externalUrl: `https://leetcode.com/problems/${slug}/`,
        difficulty: 'easy',
        status: 'published',
      })
      .returning();
    await ctx.db
      .insert(problemTags)
      .values({ problemId: problem!.id, tagType: 'topic', tagValue: topic });
    return problem!.id;
  }

  /** A solve that leaves private traces: a stuck note, a reflection and code. */
  async function solveWithPrivateTraces(problemId: string, at: Date) {
    const session = await startSession(ctx.db, {
      userId,
      timeZone: TIME_ZONE,
      now: at,
      problemId,
    });
    await markStuck(ctx.db, {
      userId,
      now: new Date(at.getTime() + 60_000),
      sessionId: session.id,
      category: 'approach',
      note: 'SECRET-STUCK-NOTE',
    });
    await completeSession(ctx.db, {
      userId,
      timeZone: TIME_ZONE,
      now: new Date(at.getTime() + 10 * 60_000),
      sessionId: session.id,
      outcome: 'solved',
    });
    await ctx.db
      .insert(reflections)
      .values({ sessionId: session.id, approach: 'SECRET-APPROACH' });
    await ctx.db.insert(codeSnapshots).values({
      sessionId: session.id,
      userId,
      sequence: 0,
      language: 'python3',
      isFull: true,
      content: 'print("SECRET-CODE")',
      sourceBytes: 20,
      trigger: 'run_attempt',
      occurredAt: at,
    });
  }

  it('A NEW ACCOUNT IS NOT PUBLIC — the default is off, and no page resolves', async () => {
    await updateProfile(ctx.db, userId, base);
    const profile = await getProfile(ctx.db, userId);
    expect(profile.publicProfileEnabled).toBe(false);
    expect(profile.handle).toBeNull();

    const [row] = await ctx.db
      .select({ enabled: userProfiles.publicProfileEnabled })
      .from(userProfiles)
      .where(eq(userProfiles.userId, userId));
    expect(row?.enabled).toBe(false);
  });

  describe('turning it on', () => {
    it('refuses to go public without a handle, and rolls the whole save back', async () => {
      await updateProfile(ctx.db, userId, base);
      await expect(
        updateProfile(ctx.db, userId, {
          ...base,
          displayName: 'Changed',
          publicProfileEnabled: true,
        }),
      ).rejects.toBeInstanceOf(PublicProfileNeedsHandleError);
      expect((await getProfile(ctx.db, userId)).displayName).toBe('Asha Rao');
    });

    it('refuses to clear the handle while the profile stays public', async () => {
      await updateProfile(ctx.db, userId, {
        ...base,
        handle: 'asha',
        publicProfileEnabled: true,
      });
      // The schema catches the explicit clear…
      await expect(
        updateProfile(ctx.db, userId, { ...base, handle: '', publicProfileEnabled: true }),
      ).rejects.toThrow(/choose a handle/i);
    });

    it('refuses a handle someone else has, whatever the case it is typed in', async () => {
      const other = (
        await createUser(ctx.db, { email: 'other@example.com', timezone: TIME_ZONE })
      ).id;
      await updateProfile(ctx.db, other, { ...base, handle: 'asha' });
      await expect(
        updateProfile(ctx.db, userId, { ...base, handle: 'ASHA' }),
      ).rejects.toBeInstanceOf(HandleTakenError);
    });

    it('a save that does not mention the handle or sections leaves them alone', async () => {
      // The onboarding path saves through the same schema without these fields.
      await updateProfile(ctx.db, userId, {
        ...base,
        handle: 'asha',
        publicProfileEnabled: true,
        publicShowTopics: false,
      });
      await updateProfile(ctx.db, userId, { ...base, publicProfileEnabled: true });

      const profile = await getProfile(ctx.db, userId);
      expect(profile.handle).toBe('asha');
      expect(profile.publicShowTopics).toBe(false);
    });
  });

  describe('the handle rule is one rule in two places', () => {
    it('Zod rejects reserved, uppercase-only-after-lowering is fine, malformed is not', () => {
      expect(handleSchema.safeParse('Asha-Rao').data).toBe('asha-rao');
      expect(handleSchema.safeParse('admin').success).toBe(false);
      expect(handleSchema.safeParse('-asha').success).toBe(false);
      expect(handleSchema.safeParse('as').success).toBe(false);
      expect(handleSchema.safeParse('a'.repeat(31)).success).toBe(false);
    });

    it('THE DATABASE REFUSES A MALFORMED HANDLE the service would never write', async () => {
      await updateProfile(ctx.db, userId, base);
      const rejection = await expectDbRejection(
        ctx.db.execute(
          sql`update user_profiles set handle = 'Not A Handle' where user_id = ${userId}`,
        ),
        'user_profiles_handle_format',
      );
      expect(rejection.code).toBe('23514');
    });
  });

  describe('what the public view contains', () => {
    beforeEach(async () => {
      await solveWithPrivateTraces(await makeProblem('arrays-hashing'), START);
      await solveWithPrivateTraces(
        await makeProblem('arrays-hashing'),
        new Date(START.getTime() + 3_600_000),
      );
      await solveWithPrivateTraces(
        await makeProblem('graphs'),
        new Date(START.getTime() + 7_200_000),
      );
    });

    it('WITH THE PROFILE ON, NOTHING PRIVATE IS IN THE VIEW', async () => {
      await updateProfile(ctx.db, userId, {
        ...base,
        handle: 'asha',
        publicProfileEnabled: true,
      });
      const view = await getPublicProfile(ctx.db, { handle: 'asha', now: NOW });

      expect(view).not.toBeNull();
      const serialised = JSON.stringify(view);
      for (const secret of [
        'SECRET-CODE',
        'SECRET-APPROACH',
        'SECRET-STUCK-NOTE',
        'SECRET-BIO',
        EMAIL,
      ]) {
        expect(serialised, secret).not.toContain(secret);
      }
      expect(view).toMatchObject({
        handle: 'asha',
        displayName: 'Asha Rao',
        totalSolved: 3,
        topics: [
          { topic: 'arrays-hashing', solved: 2 },
          { topic: 'graphs', solved: 1 },
        ],
      });
      expect(view!.currentStreak).toBeGreaterThanOrEqual(1);
    });

    it('a section that is off is null — not zero, and not queried', async () => {
      await updateProfile(ctx.db, userId, {
        ...base,
        handle: 'asha',
        publicProfileEnabled: true,
        publicShowStreak: false,
        publicShowLongestStreak: false,
        publicShowTotalSolved: false,
        publicShowTopics: false,
      });
      const view = await getPublicProfile(ctx.db, { handle: 'asha', now: NOW });
      expect(view).toMatchObject({
        currentStreak: null,
        longestStreak: null,
        totalSolved: null,
        topics: null,
      });
    });

    it('a profile that is off is indistinguishable from one that does not exist', async () => {
      await updateProfile(ctx.db, userId, {
        ...base,
        handle: 'asha',
        publicProfileEnabled: false,
      });
      expect(await getPublicProfile(ctx.db, { handle: 'asha', now: NOW })).toBeNull();
      expect(await getPublicProfile(ctx.db, { handle: 'nobody-here', now: NOW })).toBeNull();
    });

    it('a deleted account stops resolving at once', async () => {
      await updateProfile(ctx.db, userId, {
        ...base,
        handle: 'asha',
        publicProfileEnabled: true,
      });
      await ctx.db.update(users).set({ deletedAt: NOW }).where(eq(users.id, userId));
      expect(await getPublicProfile(ctx.db, { handle: 'asha', now: NOW })).toBeNull();
    });

    it('the monthly card counts the month, and only enabled sections', async () => {
      await updateProfile(ctx.db, userId, {
        ...base,
        handle: 'asha',
        publicProfileEnabled: true,
        publicShowTopics: false,
      });
      const card = await getMonthlyCard(ctx.db, { handle: 'asha', month: '2026-09', now: NOW });
      expect(card).toMatchObject({
        month: '2026-09',
        solvedThisMonth: 3,
        activeDays: 1,
        topTopic: null,
      });

      const empty = await getMonthlyCard(ctx.db, {
        handle: 'asha',
        month: '2026-08',
        now: NOW,
      });
      expect(empty?.solvedThisMonth).toBe(0);

      // An unparseable month is the owner's current month, not an error.
      const fallback = await getMonthlyCard(ctx.db, { handle: 'asha', month: 'x', now: NOW });
      expect(fallback?.month).toBe('2026-09');
    });
  });
});
