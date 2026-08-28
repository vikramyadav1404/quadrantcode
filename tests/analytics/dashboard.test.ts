/**
 * F1.6 · the dashboard read, against six months of data.
 *
 * The ticket asks for the page to render in under 500ms on a six-month dataset,
 * and for that number to be measured rather than asserted. So this file builds
 * one — 180 days, real gaps, three difficulties, six topics, a mix of solves and
 * stuck sittings — rolls it up once, and times the read.
 *
 * The dataset is generated from a fixed seed. A perf test on random data is a
 * flake waiting to happen: it fails on the unlucky run and nobody can reproduce
 * it, so the run that matters is the one everyone can repeat.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  problemTags,
  problems,
  reflectionStuckAreas,
  reflections,
  solveSessions,
  stuckPoints,
  userStreaks,
} from '@/server/db/schema';
import { readDashboard, rebuildWindow } from '@/server/services/analytics';
import {
  type TestContext,
  createUser,
  hasTestDatabase,
  setupTestDb,
  truncateAll,
} from '../helpers/db';

const suite = hasTestDatabase ? describe : describe.skip;

const TODAY = '2026-03-30';
const NOW = new Date('2026-03-30T12:00:00.000Z');
const HISTORY_DAYS = 180;

/** The budget the criterion names. */
const RENDER_BUDGET_MS = 500;

const TOPICS = ['arrays', 'graphs', 'dp', 'trees', 'greedy', 'binary-search'];
const DIFFICULTIES = ['easy', 'medium', 'hard'] as const;
const CONFIDENCES = ['low', 'medium', 'high'] as const;

/**
 * A tiny deterministic generator.
 *
 * Not for randomness — for REPEATABILITY. The same seed gives the same six
 * months on every machine, so a failure is something anyone can reproduce.
 */
function sequence(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) % 4_294_967_296;
    return state / 4_294_967_296;
  };
}

const dateOffset = (days: number): string =>
  new Date(Date.parse(`${TODAY}T00:00:00.000Z`) - days * 86_400_000).toISOString().slice(0, 10);

suite('F1.6 · readDashboard at six months', () => {
  let ctx: TestContext;
  let userId: string;
  let sessionCount = 0;
  let solvedCount = 0;

  beforeAll(async () => {
    ctx = await setupTestDb();
    await truncateAll(ctx.sql);

    userId = (await createUser(ctx.db, { email: 'analytics@example.com' })).id;
    await ctx.db.insert(userStreaks).values({ userId, currentStreak: 4, longestStreak: 19 });

    const next = sequence(20_260_330);

    // Eighteen problems: every topic at every difficulty.
    const problemRows = TOPICS.flatMap((topic, topicIndex) =>
      DIFFICULTIES.map((difficulty, difficultyIndex) => ({
        slug: `${topic}-${difficulty}`,
        title: `${topic} ${difficulty}`,
        sourceType: 'external_link' as const,
        platform: 'leetcode',
        externalUrl: `https://leetcode.com/problems/${topic}-${difficulty}/`,
        difficulty,
        estimatedMinutes: 20 + topicIndex * 5 + difficultyIndex * 10,
        topic,
      })),
    );

    const inserted = await ctx.db
      .insert(problems)
      .values(problemRows.map(({ topic: _topic, ...row }) => row))
      .returning({ id: problems.id, slug: problems.slug });

    const problemBySlug = new Map(inserted.map((row) => [row.slug, row.id]));

    await ctx.db.insert(problemTags).values(
      problemRows.map((row) => ({
        problemId: problemBySlug.get(row.slug)!,
        tagType: 'topic' as const,
        tagValue: row.topic,
      })),
    );

    /*
     * 180 days with gaps. Roughly a third of days are rest days, and active days
     * carry one to three sessions — which is what a real six months looks like,
     * and what makes the "no row for an empty day" behaviour worth having.
     */
    const sessionValues: (typeof solveSessions.$inferInsert)[] = [];

    for (let dayIndex = HISTORY_DAYS - 1; dayIndex >= 0; dayIndex -= 1) {
      if (next() < 0.35) continue; // rest day

      const localDate = dateOffset(dayIndex);
      const sessionsToday = 1 + Math.floor(next() * 3);

      for (let index = 0; index < sessionsToday; index += 1) {
        const problem = problemRows[Math.floor(next() * problemRows.length)]!;
        const roll = next();

        // Three quarters solved, a fifth stuck, the rest walked away from.
        const status = roll < 0.75 ? 'solved' : roll < 0.95 ? 'stuck' : 'abandoned';
        const minutes = 8 + Math.floor(next() * 50);

        const startedAt = new Date(
          `${localDate}T${String(6 + index * 3).padStart(2, '0')}:00:00.000Z`,
        );
        const endedAt = new Date(startedAt.getTime() + minutes * 60_000);

        sessionValues.push({
          userId,
          problemId: problemBySlug.get(problem.slug)!,
          status,
          startedAt,
          lastHeartbeatAt: endedAt,
          endedAt,
          startedLocalDate: localDate,
          endedLocalDate: localDate,
          confidence: next() < 0.7 ? CONFIDENCES[Math.floor(next() * 3)]! : null,
        });

        sessionCount += 1;
        if (status === 'solved') solvedCount += 1;
      }
    }

    // Batched, because 500 round trips would make the fixture slower than the
    // thing it is measuring.
    for (let offset = 0; offset < sessionValues.length; offset += 200) {
      await ctx.db.insert(solveSessions).values(sessionValues.slice(offset, offset + 200));
    }

    // Some stuck markers and reflections, so the distribution has both sources.
    const someSessions = await ctx.db
      .select({ id: solveSessions.id })
      .from(solveSessions)
      .limit(60);

    await ctx.db.insert(stuckPoints).values(
      someSessions.map((session, index) => ({
        sessionId: session.id,
        category: (['debugging', 'approach', 'edge_cases'] as const)[index % 3]!,
        elapsedSeconds: 120 + index * 10,
      })),
    );

    const reflectionRows = await ctx.db
      .insert(reflections)
      .values(someSessions.slice(0, 30).map((session) => ({ sessionId: session.id })))
      .returning({ id: reflections.id });

    await ctx.db.insert(reflectionStuckAreas).values(
      reflectionRows.map((row, index) => ({
        reflectionId: row.id,
        category: (['complexity', 'implementation'] as const)[index % 2]!,
      })),
    );

    await rebuildWindow(ctx.db, { userId, today: TODAY, days: HISTORY_DAYS, now: NOW });
  }, 300_000);

  afterAll(async () => {
    await ctx?.close();
  });

  const read = () =>
    readDashboard(ctx.db, { userId, today: TODAY, asOf: NOW, catchingUp: false });

  it('BUILT A DATASET WORTH MEASURING AGAINST', async () => {
    /*
     * The positive control for the timing test below. "Fast" means nothing over
     * an empty table, and a fixture that silently produced ten sessions would
     * make the budget trivially met.
     */
    /*
     * The thresholds are the generator's real output, not a hopeful round
     * number: 35% rest days over 180 days at one to three sessions each lands
     * near 235. The first version asserted 300 and failed, which is the useful
     * direction for a control to fail in — it means the numbers are being read
     * rather than assumed.
     */
    expect(sessionCount).toBeGreaterThan(200);
    expect(solvedCount).toBeGreaterThan(150);

    const [dayRows] = await ctx.sql`SELECT count(*)::int AS total FROM analytics_daily`;
    const [topicRows] = await ctx.sql`SELECT count(*)::int AS total FROM analytics_topic_daily`;

    expect(Number(dayRows!.total)).toBeGreaterThan(90);
    expect(Number(topicRows!.total)).toBeGreaterThan(150);
  });

  it('RENDERS INSIDE THE 500ms BUDGET', async () => {
    // The acceptance criterion, measured rather than asserted. One warm call
    // first so the number is the query cost, not the connection's first packet.
    await read();

    const started = performance.now();
    const data = await read();
    const elapsed = performance.now() - started;

    expect(data.headline.totalSolved).toBe(solvedCount);
    expect(elapsed).toBeLessThan(RENDER_BUDGET_MS);

    // Recorded in the acceptance status; printed so a slow machine shows why.
    console.log(`readDashboard: ${elapsed.toFixed(1)}ms over ${sessionCount} sessions`);
  });

  it('reads only the rollup — the raw session tables are never scanned', async () => {
    /*
     * The architecture rule, checked rather than trusted. If the read touched
     * `solve_sessions`, emptying the rollup would still produce numbers.
     */
    await ctx.sql`DELETE FROM analytics_daily WHERE user_id = ${userId}`;

    const emptied = await read();
    expect(emptied.headline.totalSolved).toBe(0);

    await rebuildWindow(ctx.db, { userId, today: TODAY, days: HISTORY_DAYS, now: NOW });
    expect((await read()).headline.totalSolved).toBe(solvedCount);
  });

  it('splits the solves by difficulty, and the split adds up', async () => {
    const data = await read();
    const { easy, medium, hard } = data.difficulty;

    expect(easy + medium + hard).toBe(data.headline.totalSolved);
    expect(easy).toBeGreaterThan(0);
    expect(hard).toBeGreaterThan(0);
  });

  it('returns twelve trend buckets, oldest first', async () => {
    const data = await read();

    expect(data.trend).toHaveLength(12);
    expect(data.trend[0]!.weekStart < data.trend[11]!.weekStart).toBe(true);
    // Every bucket that had a solve reports minutes; one that had none says so.
    for (const point of data.trend) {
      if (point.averageMinutesPerProblem !== null) {
        expect(point.averageMinutesPerProblem).toBeGreaterThan(0);
      }
    }
  });

  it('reports every topic with an average that came from real sessions', async () => {
    const data = await read();

    expect(data.topics.length).toBe(TOPICS.length);
    for (const topic of data.topics) {
      expect(topic.sessionCount).toBeGreaterThan(0);
      expect(topic.averageActiveSeconds).toBeGreaterThan(0);
      expect(topic.failedAttemptRatio).toBeGreaterThanOrEqual(0);
      expect(topic.failedAttemptRatio).toBeLessThanOrEqual(1);
      expect(topic.lastPractisedDate).not.toBeNull();
    }
  });

  it('EVERY WEAK TOPIC ARRIVES WITH ITS REASONS', async () => {
    // The acceptance criterion, at the layer the page actually reads.
    const data = await read();

    expect(data.weakTopics.length).toBeGreaterThan(0);
    for (const weak of data.weakTopics) {
      expect(weak.reasons.length).toBeGreaterThan(0);
      expect(weak.score).toBeGreaterThanOrEqual(0);
      expect(weak.score).toBeLessThanOrEqual(100);
    }
  });

  it('keeps live markers and reflected areas apart in the distribution', async () => {
    const data = await read();

    const marked = data.stuckDistribution.filter((row) => row.marked > 0);
    const reflectedOnly = data.stuckDistribution.filter(
      (row) => row.reflected > 0 && row.marked === 0,
    );

    expect(marked.length).toBeGreaterThan(0);
    // 'complexity' and 'implementation' were only ever reflected, never marked.
    expect(reflectedOnly.length).toBeGreaterThan(0);
  });

  it('carries the streak straight through from F1.3', async () => {
    const data = await read();

    expect(data.headline.currentStreak).toBe(4);
    expect(data.headline.longestStreak).toBe(19);
  });
});
