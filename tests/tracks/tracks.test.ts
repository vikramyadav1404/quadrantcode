/**
 * F4.2 · preparation tracks.
 *
 * The ticket's criteria this file carries: time remaining changes when the
 * user's own speed changes; prerequisites block out-of-order section entry;
 * the declared tracks are well-formed. (The disclaimer on every track page is
 * rendered by the page itself; "all four tracks" is not met — see D38.)
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { problems, userProblems } from '@/server/db/schema';
import {
  type Track,
  TRACKS,
  TrackNotFoundError,
  getTrack,
  remainingMinutes,
  speedProfile,
} from '@/server/services/tracks';
import {
  type TestContext,
  createUser,
  hasTestDatabase,
  setupTestDb,
  truncateAll,
} from '../helpers/db';

describe('the declared tracks are well-formed', () => {
  it('every slug appears once per track, and none is a walkthrough demo row', () => {
    for (const track of TRACKS) {
      const slugs = track.sections.flatMap((section) => section.slugs);
      expect(new Set(slugs).size, track.slug).toBe(slugs.length);
      expect(
        slugs.filter((slug) => slug.startsWith('demo-')),
        track.slug,
      ).toEqual([]);
    }
  });

  it('a prerequisite is always an EARLIER section of the same track', () => {
    for (const track of TRACKS) {
      const seen = new Set<string>();
      for (const section of track.sections) {
        for (const required of section.requires)
          expect(seen.has(required), section.id).toBe(true);
        seen.add(section.id);
      }
    }
  });

  it('Fundamentals ships with the 30 problems production publishes', () => {
    const fundamentals = TRACKS.find((track) => track.slug === 'fundamentals')!;
    expect(fundamentals.sections.flatMap((section) => section.slugs)).toHaveLength(30);
  });
});

describe("time remaining follows THIS user's speed", () => {
  const unsolved = [
    { difficulty: 'easy' as const, estimatedMinutes: 20 },
    { difficulty: 'medium' as const, estimatedMinutes: 30 },
  ];

  it('with no solves it is the plain estimate', () => {
    const profile = speedProfile([]);
    expect(profile.overall).toBeNull();
    expect(remainingMinutes(unsolved, profile)).toBe(50);
  });

  it('A FASTER USER GETS LESS TIME, A SLOWER ONE MORE — by difficulty', () => {
    const fast = speedProfile([{ difficulty: 'easy', bestSeconds: 600, estimatedMinutes: 20 }]);
    const slow = speedProfile([
      { difficulty: 'easy', bestSeconds: 2_400, estimatedMinutes: 20 },
    ]);
    // Easy scales by the easy ratio; medium borrows the overall ratio.
    expect(remainingMinutes(unsolved, fast)).toBe(25); // 20*0.5 + 30*0.5
    expect(remainingMinutes(unsolved, slow)).toBe(100); // 20*2 + 30*2
  });
});

const suite = hasTestDatabase ? describe : describe.skip;

suite('F4.2 · a track against a real database', () => {
  let ctx: TestContext;
  let userId: string;

  const TEST_TRACK: Track = {
    slug: 'test-track',
    title: 'Test track',
    description: 'A two-section track for tests.',
    sections: [
      { id: 'first', title: 'First', requires: [], slugs: ['t-a', 't-b'] },
      {
        id: 'second',
        title: 'Second',
        requires: ['first'],
        slugs: ['t-c', 't-missing', 't-draft'],
      },
    ],
  };

  beforeAll(async () => {
    ctx = await setupTestDb();
  }, 60_000);
  afterAll(async () => ctx?.close());

  beforeEach(async () => {
    await truncateAll(ctx.sql);
    userId = (await createUser(ctx.db, { email: 'tracks@example.com' })).id;
    for (const [slug, status] of [
      ['t-a', 'published'],
      ['t-b', 'published'],
      ['t-c', 'published'],
      ['t-draft', 'draft'],
    ] as const) {
      await ctx.db.insert(problems).values({
        slug,
        title: slug.toUpperCase(),
        sourceType: 'external_link',
        platform: 'leetcode',
        externalUrl: `https://leetcode.com/problems/${slug}/`,
        difficulty: 'easy',
        estimatedMinutes: 20,
        status,
      });
    }
  });

  async function solve(slug: string, bestTimeSeconds: number, forUser = userId) {
    const [problem] = await ctx.db
      .select({ id: problems.id })
      .from(problems)
      .where(eq(problems.slug, slug));
    await ctx.db
      .insert(userProblems)
      .values({
        userId: forUser,
        problemId: problem!.id,
        status: 'solved',
        totalAttempts: 1,
        bestTimeSeconds,
      })
      .onConflictDoUpdate({
        target: [userProblems.userId, userProblems.problemId],
        set: { status: 'solved', bestTimeSeconds },
      });
  }

  const track = () => getTrack(ctx.db, { userId, slug: 'test-track', tracks: [TEST_TRACK] });

  it('counts only what the catalog publishes, and says how many it left out', async () => {
    const view = await track();
    expect(view.total).toBe(3);
    expect(view.unavailable).toBe(2); // one missing slug, one draft
    expect(view.sections[1]!.problems.map((problem) => problem.slug)).toEqual(['t-c']);
  });

  it('PREREQUISITES BLOCK OUT-OF-ORDER ENTRY until the earlier section is complete', async () => {
    await solve('t-a', 600);
    let view = await track();
    expect(view.sections[1]!.unlocked).toBe(false);
    expect(view.sections[1]!.requires).toEqual(['First']);
    expect(view.next?.slug).toBe('t-b');

    await solve('t-b', 600);
    view = await track();
    expect(view.sections[0]!.complete).toBe(true);
    expect(view.sections[1]!.unlocked).toBe(true);
    expect(view.next?.slug).toBe('t-c');
    expect(view.percent).toBe(67);
  });

  it("TIME REMAINING CHANGES WHEN THE USER'S OWN SPEED CHANGES", async () => {
    const before = await track();
    expect(before.estimateFromDefaults).toBe(true);
    expect(before.remainingMinutes).toBe(60);

    await solve('t-a', 600); // half the 20-minute estimate
    const fast = await track();
    expect(fast.estimateFromDefaults).toBe(false);
    expect(fast.remainingMinutes).toBe(20); // two left × 20 × 0.5

    await solve('t-a', 2_400); // now twice the estimate
    const slow = await track();
    expect(slow.remainingMinutes).toBe(80);
  });

  it("another user's solves do not move this user's track", async () => {
    const other = (await createUser(ctx.db, { email: 'someone@example.com' })).id;
    await solve('t-a', 600, other);
    expect((await track()).solved).toBe(0);
  });

  it('an unknown track is a typed not-found', async () => {
    await expect(
      getTrack(ctx.db, { userId, slug: 'nope', tracks: [TEST_TRACK] }),
    ).rejects.toBeInstanceOf(TrackNotFoundError);
  });
});
