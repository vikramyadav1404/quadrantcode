/**
 * F1.4 · the adversarial requirement.
 *
 * > "Write a test that posts a forged duration and a forged client timestamp to
 * >  every endpoint and asserts the server's computed value is unchanged."
 *
 * The interesting part is WHY it passes. There is no code anywhere that reads a
 * client-supplied time and decides to ignore it — the fields simply do not
 * exist in any schema, so a forged one is dropped by `parse` before a handler
 * sees it and the server computes from timestamps it wrote itself.
 *
 * That makes the test a check on the SHAPE of the contract rather than on a
 * defensive branch, which is the version that keeps working: a defensive branch
 * can be deleted by someone who thinks it is dead code, whereas adding a
 * `durationSeconds` field to a schema is an obvious change to make.
 *
 * The HTTP half — a real browser posting a forged body to the heartbeat route —
 * is `e2e/session.spec.ts`, because this suite has no server to post to.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { problems } from '@/server/db/schema';
import {
  completeSession,
  heartbeat,
  pauseSession,
  resumeSession,
  startSession,
} from '@/server/services/session';
import {
  FORGEABLE_TIME_FIELDS,
  completeSessionSchema,
  sessionIdSchema,
  startSessionSchema,
} from '@/server/services/session/input';
import {
  type TestContext,
  createUser,
  hasTestDatabase,
  setupTestDb,
  truncateAll,
} from '../helpers/db';

const START = new Date('2026-03-02T10:00:00.000Z');
const at = (minutes: number) => new Date(START.getTime() + minutes * 60_000);
const TIME_ZONE = 'Asia/Kolkata';

/** What a hostile client sends: every field it might hope the server trusts. */
const FORGERY = Object.fromEntries(
  FORGEABLE_TIME_FIELDS.map((field) => [
    field,
    field.endsWith('At') || field.endsWith('timestamp') || field === 'now'
      ? '1999-01-01T00:00:00.000Z'
      : 999_999,
  ]),
);

describe('F1.4 · no schema has anywhere to put a time', () => {
  it('strips every forged field from a start payload', () => {
    const parsed = startSessionSchema.parse({
      problemId: '11111111-1111-4111-8111-111111111111',
      ...FORGERY,
    });

    expect(Object.keys(parsed)).toEqual(['problemId']);
  });

  it('strips every forged field from a session-id payload', () => {
    const parsed = sessionIdSchema.parse({
      sessionId: '22222222-2222-4222-8222-222222222222',
      ...FORGERY,
    });

    expect(Object.keys(parsed)).toEqual(['sessionId']);
  });

  it('strips every forged field from a completion payload', () => {
    const parsed = completeSessionSchema.parse({
      sessionId: '33333333-3333-4333-8333-333333333333',
      outcome: 'solved',
      confidence: 'high',
      ...FORGERY,
    });

    expect(Object.keys(parsed).sort()).toEqual(['confidence', 'outcome', 'sessionId']);
  });

  it('THE FORGERY LIST IS NOT EMPTY', () => {
    /*
     * The positive control. Every assertion above is "these keys are absent",
     * which passes trivially if the list being forged is empty — the same
     * vacuous-pass failure the gitleaks canary had.
     */
    expect(FORGEABLE_TIME_FIELDS.length).toBeGreaterThan(5);
    expect(Object.keys(FORGERY)).toContain('activeDurationSeconds');
    expect(Object.keys(FORGERY)).toContain('now');
  });
});

const suite = hasTestDatabase ? describe : describe.skip;

suite('F1.4 · a forged payload changes nothing the server computed', () => {
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
    userId = (await createUser(ctx.db, { email: 'forger@example.com', timezone: TIME_ZONE }))
      .id;

    const [problem] = await ctx.db
      .insert(problems)
      .values({
        slug: 'two-sum',
        title: 'Two Sum',
        sourceType: 'external_link',
        platform: 'leetcode',
        externalUrl: 'https://leetcode.com/problems/two-sum/',
        difficulty: 'easy',
      })
      .returning();
    problemId = problem!.id;
  });

  /**
   * What an adapter does with a hostile body: parse it, then supply `now`
   * itself. Written out here so the test exercises the same two steps the
   * action and the route perform, rather than a shortcut neither of them takes.
   */
  const asAdapterWouldStart = (payload: Record<string, unknown>, now: Date) => ({
    ...startSessionSchema.parse(payload),
    userId,
    timeZone: TIME_ZONE,
    now,
  });

  const asAdapterWouldAct = (payload: Record<string, unknown>, now: Date) => ({
    ...sessionIdSchema.parse(payload),
    userId,
    timeZone: TIME_ZONE,
    now,
  });

  it('a forged duration does not survive the round trip', async () => {
    const session = await startSession(
      ctx.db,
      asAdapterWouldStart({ problemId, ...FORGERY }, START),
    );

    // The client claims almost twelve days of work. The server counted zero
    // seconds, because that is how long ago it wrote `started_at`.
    expect(session.activeDurationSeconds).toBe(0);
    expect(session.activeDurationSeconds).not.toBe(999_999);
  });

  it('a forged timestamp does not move the heartbeat the server records', async () => {
    const session = await startSession(ctx.db, asAdapterWouldStart({ problemId }, START));

    await heartbeat(ctx.db, asAdapterWouldAct({ sessionId: session.id, ...FORGERY }, at(3)));

    const [row] = await ctx.sql`
      SELECT last_heartbeat_at FROM solve_sessions WHERE id = ${session.id}
    `;
    // 1999, if the forgery had landed.
    expect(new Date(String(row!.last_heartbeat_at)).toISOString()).toBe(at(3).toISOString());
  });

  it('forged pause and resume times do not change the arithmetic', async () => {
    const session = await startSession(ctx.db, asAdapterWouldStart({ problemId }, START));

    await pauseSession(
      ctx.db,
      asAdapterWouldAct({ sessionId: session.id, ...FORGERY }, at(10)),
    );
    await resumeSession(
      ctx.db,
      asAdapterWouldAct({ sessionId: session.id, ...FORGERY }, at(15)),
    );

    const finished = await completeSession(ctx.db, {
      ...completeSessionSchema.parse({
        sessionId: session.id,
        outcome: 'solved',
        ...FORGERY,
      }),
      userId,
      timeZone: TIME_ZONE,
      now: at(30),
    });

    // 30 minutes of wall time, 5 of them paused — computed from the instants
    // the server stamped, not from anything in the payload.
    expect(finished.activeDurationSeconds).toBe(25 * 60);
  });

  it('THE ASSERTION CAN FAIL — an honest change to the clock does move it', async () => {
    /*
     * The positive control for the three above. They assert "the number did not
     * change", which would also pass if the number were frozen for some
     * unrelated reason — a broken duration function, say. This proves the value
     * genuinely tracks the server's own timestamps.
     */
    const session = await startSession(ctx.db, asAdapterWouldStart({ problemId }, START));

    const early = await completeSession(ctx.db, {
      sessionId: session.id,
      outcome: 'solved',
      userId,
      timeZone: TIME_ZONE,
      now: at(7),
    });

    expect(early.activeDurationSeconds).toBe(7 * 60);
  });
});
