/**
 * F3.5 · the weekly plan, the warning cap, and the risk feed.
 *
 * Three criteria:
 *
 *   · "Every weekly-plan recommendation displays its reason" — asserted here at
 *     the data layer and again in the browser
 *   · "Pre-solve warning appears at most once per pattern per day"
 *   · "Mistake severity measurably changes a forgetting-risk score"
 *
 * The last one is worded carefully in the ticket — *measurably*. So the test
 * compares two actual scores rather than asserting that a field was passed.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  mistakePatterns,
  mistakeWarningsShown,
  problemTags,
  problems,
} from '@/server/db/schema';
import { buildWeeklyPlan, reasonFor, type PatternInput } from '@/server/services/mistakes/plan';
import { dismissWarning, warningFor } from '@/server/services/mistakes/warning';
import { scoreRisk } from '@/server/services/revision';
import {
  type TestContext,
  createUser,
  hasTestDatabase,
  setupTestDb,
  truncateAll,
} from '../helpers/db';

const suite = hasTestDatabase ? describe : describe.skip;

const TODAY = new Date('2026-07-01T12:00:00.000Z');
const daysAgo = (days: number) => new Date(TODAY.getTime() - days * 24 * 60 * 60 * 1000);

function pattern(overrides: Partial<PatternInput> = {}): PatternInput {
  return {
    category: 'off_by_one',
    topic: 'binary-search',
    occurrences: 7,
    confirmedStuckCount: 0,
    trend: 'flat',
    lastSeenOn: daysAgo(3),
    ...overrides,
  };
}

describe('F3.5 · EVERY RECOMMENDATION CARRIES ITS REASON', () => {
  it('never emits one without the other', () => {
    /*
     * The ticket: "If you cannot state the reason in one sentence, the rule is
     * wrong." A plan the user cannot check is one they follow on faith, and the
     * first week it is wrong they stop following it at all.
     */
    const plan = buildWeeklyPlan(
      [
        pattern(),
        pattern({ category: 'wrong_data_structure', topic: 'graphs', occurrences: 4 }),
        pattern({ category: 'missed_edge_case', topic: 'dp', occurrences: 3 }),
      ],
      TODAY,
    );

    expect(plan.recommendations.length).toBeGreaterThan(0);
    for (const recommendation of plan.recommendations) {
      expect(recommendation.reason.length).toBeGreaterThan(10);
      expect(recommendation.reason).toMatch(/\.$/);
    }
  });

  it('the reason names what actually drove it, not a generic phrase', () => {
    const worsening = reasonFor(pattern({ trend: 'worsening' }), TODAY);
    const stuck = reasonFor(pattern({ confirmedStuckCount: 4 }), TODAY);
    const recent = reasonFor(pattern({ lastSeenOn: daysAgo(2) }), TODAY);

    expect(worsening).toMatch(/more often lately/);
    expect(stuck).toMatch(/confirmed 4 stuck points/);
    expect(recent).toMatch(/this week/);

    // A reason that would fit any recommendation is not a reason.
    expect(new Set([worsening, stuck, recent]).size).toBe(3);
  });

  it('says so out loud when there is nothing to recommend', () => {
    // An empty list renders as an empty panel and reads like a bug.
    const plan = buildWeeklyPlan([], TODAY);
    expect(plan.recommendations).toEqual([]);
    expect(plan.note).toMatch(/nothing/i);
  });

  it('DROPS A MISTAKE THE USER HAS ALREADY STOPPED MAKING', () => {
    // Four months old. Recommending it would send someone to practise a problem
    // they have already fixed.
    const plan = buildWeeklyPlan([pattern({ lastSeenOn: daysAgo(120) })], TODAY);
    expect(plan.recommendations).toEqual([]);
  });

  it('gives every focus area at least one problem', () => {
    const plan = buildWeeklyPlan(
      [
        pattern({ occurrences: 20 }),
        pattern({ category: 'wrong_data_structure', topic: 'graphs', occurrences: 1 }),
      ],
      TODAY,
    );

    // A plan assigning five to one area and zero to another is one item
    // pretending to be two.
    for (const recommendation of plan.recommendations) {
      expect(recommendation.count).toBeGreaterThanOrEqual(1);
    }
    expect(plan.recommendations.reduce((sum, r) => sum + r.count, 0)).toBe(5);
  });

  it('is deterministic', () => {
    const input = [pattern(), pattern({ category: 'missed_edge_case', occurrences: 7 })];
    const first = JSON.stringify(buildWeeklyPlan(input, TODAY));

    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect(JSON.stringify(buildWeeklyPlan(input, TODAY))).toBe(first);
    }
  });
});

describe('F3.5 · MISTAKE SEVERITY MEASURABLY CHANGES A RISK SCORE', () => {
  const base = {
    daysOverdue: 2,
    confidence: 'medium' as const,
    hintsUsed: 0,
    failedAttempts: 0,
    mistakes: [],
    topicWeakness: null,
  };

  it('a recurring mistake raises the score', () => {
    // "Measurably" — two real scores compared, not a field asserted present.
    const without = scoreRisk(base).score;
    const with_ = scoreRisk({ ...base, recurringSeverity: 1 }).score;

    expect(with_).toBeGreaterThan(without);
  });

  it('and the factor says WHY, naming recurrence rather than this attempt', () => {
    const scored = scoreRisk({ ...base, recurringSeverity: 1 });
    const factor = scored.factors.find((entry) => entry.key === 'mistakes');

    // Saying "you last recorded an off-by-one" when recurrence drove it points
    // the user at the wrong thing: the problem is the habit, not this attempt.
    expect(factor?.label).toMatch(/keep repeating/);
  });

  it('leaves the score alone when there is no recurrence data', () => {
    // Absent means "we do not know", which is what was true before this ticket
    // — not "zero recurrence".
    expect(scoreRisk({ ...base, recurringSeverity: undefined }).score).toBe(
      scoreRisk(base).score,
    );
  });

  it('does not let recurrence hide a worse mistake on this problem', () => {
    const severe = scoreRisk({ ...base, mistakes: ['wrong_data_structure'] }).score;
    const both = scoreRisk({
      ...base,
      mistakes: ['wrong_data_structure'],
      recurringSeverity: 0.1,
    }).score;

    // `max`, not an average — a mild habit must not dilute a serious error.
    expect(both).toBeGreaterThanOrEqual(severe);
  });
});

suite('F3.5 · the pre-solve warning', () => {
  let ctx: TestContext;
  let userId: string;
  let problemId: string;

  beforeAll(async () => {
    ctx = await setupTestDb();
  }, 60_000);

  afterAll(async () => {
    await ctx?.close();
  });

  beforeEach(async () => {
    await truncateAll(ctx.sql);
    userId = (await createUser(ctx.db, { email: 'warn@example.com' })).id;

    const [problem] = await ctx.db
      .insert(problems)
      .values({
        slug: 'warn-fixture',
        title: 'Warning fixture',
        sourceType: 'external_link',
        platform: 'leetcode',
        externalUrl: 'https://leetcode.com/problems/warn-fixture/',
        difficulty: 'medium',
      })
      .returning();
    problemId = problem!.id;

    await ctx.db
      .insert(problemTags)
      .values({ problemId, tagType: 'topic', tagValue: 'binary-search' });

    await ctx.db.insert(mistakePatterns).values({
      userId,
      category: 'off_by_one',
      topic: 'binary-search',
      occurrences: 7,
      confirmedStuckCount: 0,
      recentCount: 4,
      earlierCount: 3,
      trend: 'flat',
      firstSeenOn: daysAgo(50),
      lastSeenOn: daysAgo(3),
    });
  });

  const ask = () => warningFor(ctx.db, { userId, problemId, todayLocalDate: '2026-07-01' });

  it('shows a matching pattern once', async () => {
    const warning = await ask();
    expect(warning?.category).toBe('off_by_one');
    expect(warning?.message).toMatch(/came up 7 times/);
  });

  it('DOES NOT SHOW IT A SECOND TIME THE SAME DAY', async () => {
    await ask();
    expect(await ask()).toBeNull();
  });

  it('POSITIVE CONTROL · the NEXT DAY it can show again', async () => {
    /*
     * Without this, a warning that never appeared at all would pass the
     * assertion above.
     */
    await ask();
    const tomorrow = await warningFor(ctx.db, {
      userId,
      problemId,
      todayLocalDate: '2026-07-02',
    });

    expect(tomorrow).not.toBeNull();
  });

  it('reads like a statement, not a nag', async () => {
    const warning = await ask();

    expect(warning?.message).not.toMatch(/!|watch out|be careful|don't forget/i);
    expect(warning?.message).toMatch(/\.$/);
  });

  it('DISMISSAL PERSISTS, and outlasts the day', async () => {
    const warning = await ask();
    await dismissWarning(ctx.db, { userId, warningId: warning!.id, now: TODAY });

    const [row] = await ctx.db
      .select({ dismissedAt: mistakeWarningsShown.dismissedAt })
      .from(mistakeWarningsShown)
      .where(eq(mistakeWarningsShown.userId, userId));

    expect(row?.dismissedAt).not.toBeNull();
  });

  it('says nothing about a problem with no matching topic', async () => {
    const [other] = await ctx.db
      .insert(problems)
      .values({
        slug: 'warn-other',
        title: 'Other',
        sourceType: 'external_link',
        platform: 'leetcode',
        externalUrl: 'https://leetcode.com/problems/warn-other/',
        difficulty: 'easy',
      })
      .returning();

    await ctx.db
      .insert(problemTags)
      .values({ problemId: other!.id, tagType: 'topic', tagValue: 'graphs' });

    expect(
      await warningFor(ctx.db, {
        userId,
        problemId: other!.id,
        todayLocalDate: '2026-07-01',
      }),
    ).toBeNull();
  });

  it('says nothing for a user with no patterns', async () => {
    const stranger = (await createUser(ctx.db, { email: 'stranger@example.com' })).id;

    expect(
      await warningFor(ctx.db, {
        userId: stranger,
        problemId,
        todayLocalDate: '2026-07-01',
      }),
    ).toBeNull();
  });
});
