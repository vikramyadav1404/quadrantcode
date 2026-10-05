/**
 * C2 · `getSessionStrip`, the light read behind the v2 session strip.
 *
 * Pinned here: it returns only what the strip needs, with paused time taken
 * out of the elapsed figures; it refuses another user's session; it writes
 * nothing; and it costs a fraction of `getTimeline`, which must stay out of the
 * /solve render path (a 504 FUNCTION_INVOCATION_TIMEOUT was seen in production).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from '@/server/db/schema';
import { problems, sessionEvents, solveSessions } from '@/server/db/schema';
import { recordEvent } from '@/server/services/session/events';
import { captureSnapshot } from '@/server/services/timeline/snapshots';
import { getSessionStrip } from '@/server/services/timeline/strip';
import { getTimeline } from '@/server/services/timeline/detail';
import {
  type TestContext,
  createUser,
  hasTestDatabase,
  setupTestDb,
  truncateAll,
} from '../helpers/db';

const suite = hasTestDatabase ? describe : describe.skip;

const START = new Date('2026-05-01T09:00:00.000Z');
const at = (minutes: number) => new Date(START.getTime() + minutes * 60_000);

suite('C2 · the session strip read', () => {
  let ctx: TestContext;
  let userId: string;
  let otherUserId: string;
  let sessionId: string;

  beforeAll(async () => {
    ctx = await setupTestDb();
  }, 60_000);

  afterAll(async () => {
    await ctx?.close();
  });

  beforeEach(async () => {
    await truncateAll(ctx.sql);
    userId = (await createUser(ctx.db, { email: 'strip@example.com' })).id;
    otherUserId = (await createUser(ctx.db, { email: 'strip-other@example.com' })).id;

    const [problem] = await ctx.db
      .insert(problems)
      .values({
        slug: 'strip-fixture',
        title: 'Strip fixture',
        sourceType: 'external_link',
        platform: 'leetcode',
        externalUrl: 'https://leetcode.com/problems/strip-fixture/',
        difficulty: 'easy',
      })
      .returning();

    const [session] = await ctx.db
      .insert(solveSessions)
      .values({
        userId,
        problemId: problem!.id,
        startedAt: START,
        startedLocalDate: '2026-05-01',
      })
      .returning();
    sessionId = session!.id;

    const event = (
      type: Parameters<typeof recordEvent>[1]['type'],
      minute: number,
      payload?: Record<string, unknown>,
    ) =>
      recordEvent(ctx.db, {
        sessionId,
        type,
        occurredAt: at(minute),
        ...(payload ? { payload } : {}),
      });

    await event('session_started', 0);
    await captureSnapshot(ctx.db, {
      sessionId,
      userId,
      language: 'python3',
      source: 'print(1)\n',
      trigger: 'run_attempt',
      occurredAt: at(2),
      enabled: true,
    });
    await event('code_snapshot', 2, { sequence: 0 });
    await event('run_attempted', 2, {
      mode: 'run',
      verdict: 'wrong_answer',
      serverVerified: true,
    });
    await event('paused', 3);
    await event('resumed', 8);
    await event('stuck_marked', 9, { category: 'edge_cases', elapsedSeconds: 240 });
    await event('run_attempted', 10, {
      mode: 'submit',
      verdict: 'accepted',
      serverVerified: true,
    });
  });

  const strip = () => getSessionStrip(ctx.db, { userId, sessionId, now: at(11) });

  it('RETURNS ONLY WHAT THE STRIP NEEDS, in order, without code snapshots', async () => {
    const events = await strip();
    expect(events?.map((event) => event.type)).toEqual([
      'session_started',
      'run_attempted',
      'paused',
      'resumed',
      'stuck_marked',
      'run_attempted',
    ]);
    // Nothing beyond the strip's fields leaves the server.
    expect(Object.keys(events![0]!).sort()).toEqual(
      ['category', 'elapsedSeconds', 'id', 'type', 'verdict'].sort(),
    );
  });

  it('ELAPSED EXCLUDES PAUSED TIME, like every other duration (D20)', async () => {
    const events = (await strip())!;
    const seconds = events.map((event) => event.elapsedSeconds);
    // 0 · 2m · 3m · resumed after a 5-minute pause → 3m · 9m-5 → 4m · 10m-5 → 5m
    expect(seconds).toEqual([0, 120, 180, 180, 240, 300]);
  });

  it('carries the run verdicts and the stuck category, and nothing else of the payload', async () => {
    const events = (await strip())!;
    expect(
      events.filter((event) => event.type === 'run_attempted').map((event) => event.verdict),
    ).toEqual(['wrong_answer', 'accepted']);
    expect(events.find((event) => event.type === 'stuck_marked')?.category).toBe('edge_cases');
    expect(events.find((event) => event.type === 'paused')?.verdict).toBeNull();
  });

  it("REFUSES ANOTHER USER'S SESSION: null, as if it did not exist", async () => {
    expect(
      await getSessionStrip(ctx.db, { userId: otherUserId, sessionId, now: at(11) }),
    ).toBeNull();
  });

  it('WRITES NOTHING', async () => {
    const count = async () => ({
      events: (await ctx.db.select({ id: sessionEvents.id }).from(sessionEvents)).length,
      sessions: (await ctx.db.select({ id: solveSessions.id }).from(solveSessions)).length,
    });
    const before = await count();
    await strip();
    await strip();
    expect(await count()).toEqual(before);
  });

  it('COSTS A FRACTION OF getTimeline: two queries, no snapshots, no run output', async () => {
    const statements: string[] = [];
    const logged = drizzle(ctx.sql, {
      schema,
      casing: 'snake_case',
      logger: { logQuery: (query) => statements.push(query) },
    });
    const touches = (table: string) =>
      statements.some((statement) => statement.includes(`"${table}"`));

    await getSessionStrip(logged, { userId, sessionId, now: at(11) });
    const stripStatements = statements.length;
    const stripTouchesSnapshots = touches('code_snapshots');
    const stripTouchesRuns = touches('run_attempts');

    statements.length = 0;
    await getTimeline(logged, { userId, sessionId, now: at(11) });
    const timelineStatements = statements.length;

    // Recorded in the PR as the before/after cost.
    process.stdout.write(
      `${JSON.stringify({
        stripStatements,
        timelineStatements,
        timelineTouchesSnapshots: touches('code_snapshots'),
        timelineTouchesRuns: touches('run_attempts'),
      })}\n`,
    );

    expect(stripStatements).toBe(2);
    expect(stripTouchesSnapshots).toBe(false);
    expect(stripTouchesRuns).toBe(false);
    // POSITIVE CONTROL: the logger sees what getTimeline really does.
    expect(touches('code_snapshots')).toBe(true);
    expect(touches('run_attempts')).toBe(true);
    expect(timelineStatements).toBeGreaterThan(stripStatements);
  });
});
