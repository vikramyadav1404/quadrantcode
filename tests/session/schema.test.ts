/**
 * F1.4 · what the DATABASE guarantees about a solve session.
 *
 * These assert behaviour that must hold with every service module bypassed.
 * "One active session per user" is a rule the lifecycle enforces with a good
 * error message; it is a rule the partial unique index makes TRUE, including
 * for the case the service cannot see — two requests racing to start.
 *
 * Same defence-in-depth argument as the C1 CHECK: the service gives the
 * explanation, the constraint is the backstop.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { problems, solveSessions } from '@/server/db/schema';
import {
  type TestContext,
  createUser,
  expectDbRejection,
  hasTestDatabase,
  setupTestDb,
  truncateAll,
} from '../helpers/db';

const suite = hasTestDatabase ? describe : describe.skip;

suite('F1.4 · solve_sessions constraints', () => {
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
    userId = (await createUser(ctx.db, { email: 'session-schema@example.com' })).id;

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

  const live = () => ({ userId, problemId, startedLocalDate: '2026-03-02' });

  /*
   * Explicit timestamps, both from Node.
   *
   * The first version left `started_at` to the column default and set
   * `ended_at` to `new Date()`, mixing Node's clock with the database's. The
   * default is evaluated when the INSERT runs, which is after the JavaScript
   * value was computed, so every "finished" row was born ending before it
   * started — and `solve_sessions_ends_after_start` rejected all of them. The
   * constraint was right and the fixture was wrong, which is the better way
   * round to find out.
   */
  const STARTED_AT = new Date('2026-03-02T10:00:00.000Z');
  const ENDED_AT = new Date('2026-03-02T10:30:00.000Z');

  const finished = (status: 'solved' | 'stuck' | 'abandoned' = 'solved') => ({
    ...live(),
    status,
    startedAt: STARTED_AT,
    lastHeartbeatAt: ENDED_AT,
    endedAt: ENDED_AT,
    endedLocalDate: '2026-03-02',
  });

  describe('one live session per user', () => {
    it('rejects a second ACTIVE session', async () => {
      await ctx.db.insert(solveSessions).values(live());

      await expectDbRejection(
        ctx.db.insert(solveSessions).values(live()),
        'solve_sessions_one_live_per_user',
      );
    });

    it('rejects a new session while the existing one is merely PAUSED', async () => {
      /*
       * The reason the index covers two statuses rather than one. A paused
       * session is still the user's session — treating it as free would orphan
       * work they intend to come back to, which is precisely what the ticket's
       * "never silently reassign" forbids.
       */
      await ctx.db.insert(solveSessions).values({ ...live(), status: 'paused' });

      await expectDbRejection(
        ctx.db.insert(solveSessions).values(live()),
        'solve_sessions_one_live_per_user',
      );
    });

    it('allows a new session once the previous one is terminal', async () => {
      await ctx.db.insert(solveSessions).values(finished());

      const [next] = await ctx.db.insert(solveSessions).values(live()).returning();
      expect(next?.status).toBe('active');
    });

    it('places no limit on FINISHED sessions', async () => {
      // A user has as many finished sessions as they have attempts. A
      // non-partial unique index would have capped that at one.
      await ctx.db.insert(solveSessions).values(finished('solved'));
      await ctx.db.insert(solveSessions).values(finished('stuck'));
      await ctx.db.insert(solveSessions).values(finished('abandoned'));

      const rows = await ctx.sql`SELECT id FROM solve_sessions WHERE user_id = ${userId}`;
      expect(rows).toHaveLength(3);
    });

    it('scopes the rule to ONE user', async () => {
      const other = await createUser(ctx.db, { email: 'other-session@example.com' });
      await ctx.db.insert(solveSessions).values(live());

      const [theirs] = await ctx.db
        .insert(solveSessions)
        .values({ userId: other.id, problemId, startedLocalDate: '2026-03-02' })
        .returning();

      expect(theirs?.userId).toBe(other.id);
    });
  });

  describe('a session cannot be half-finished', () => {
    it('rejects a terminal status with no end', async () => {
      // The shape that would let a "solved" session keep counting time.
      await expectDbRejection(
        ctx.db.insert(solveSessions).values({ ...live(), status: 'solved' }),
        'solve_sessions_terminal_has_end',
      );
    });

    it('rejects a terminal status with an end but no local date', async () => {
      // Losing the local date loses which day the streak should credit, and it
      // cannot be recovered later without re-resolving a past instant (D18).
      const { endedLocalDate: _omitted, ...withoutLocalDate } = finished();

      await expectDbRejection(
        ctx.db.insert(solveSessions).values(withoutLocalDate),
        'solve_sessions_terminal_has_end',
      );
    });

    it('rejects a LIVE session that already carries an end', async () => {
      await expectDbRejection(
        ctx.db.insert(solveSessions).values({ ...finished(), status: 'active' }),
        'solve_sessions_terminal_has_end',
      );
    });
  });

  describe('time cannot run backwards', () => {
    it('rejects an end before the start', async () => {
      const startedAt = new Date('2026-03-02T10:00:00.000Z');
      await expectDbRejection(
        ctx.db.insert(solveSessions).values({
          ...live(),
          status: 'solved',
          startedAt,
          endedAt: new Date(startedAt.getTime() - 1000),
          endedLocalDate: '2026-03-02',
        }),
        'solve_sessions_ends_after_start',
      );
    });

    it('rejects a heartbeat from before the session began', async () => {
      /*
       * The client cannot set this — the server stamps it — but the constraint
       * is what makes that claim checkable rather than merely intended.
       */
      const startedAt = new Date('2026-03-02T10:00:00.000Z');
      await expectDbRejection(
        ctx.db.insert(solveSessions).values({
          ...live(),
          startedAt,
          lastHeartbeatAt: new Date(startedAt.getTime() - 1000),
        }),
        'solve_sessions_heartbeat_after_start',
      );
    });
  });
});
