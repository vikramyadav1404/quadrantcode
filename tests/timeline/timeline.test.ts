/**
 * F3.2 · the timeline against a real database.
 *
 * Four of this ticket's criteria are claims about Postgres, not about
 * TypeScript, and none of them can be settled anywhere else:
 *
 *   · an UPDATE against `session_events` is rejected AT THE DATABASE LEVEL
 *   · `reconstruct()` rebuilds source byte-identical at several checkpoints
 *   · capture turned off produces zero snapshot rows
 *   · "delete my solve history" leaves no snapshot or event rows
 *
 * The first and the last pull in opposite directions — the log refuses DELETE,
 * and the deletion has to work — so both are asserted here, in the same file,
 * where the tension is visible.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { codeSnapshots, problems, sessionEvents, solveSessions } from '@/server/db/schema';
import { recordEvent } from '@/server/services/session/events';
import { captureSnapshot, SnapshotTooLargeError } from '@/server/services/timeline/snapshots';
import { reconstruct, reconstructSession } from '@/server/services/timeline/reconstruct';
import {
  deleteSessionHistory,
  deleteSolveHistory,
  purgeExpiredSnapshots,
} from '@/server/services/timeline/retention';
import { elapsedMsFor, loadTimeline } from '@/server/services/timeline/events';
import { SNAPSHOT_INTERVAL_MS } from '@/lib/timeline/events';
import {
  type TestContext,
  createUser,
  expectDbRejection,
  hasTestDatabase,
  setupTestDb,
  truncateAll,
} from '../helpers/db';

const suite = hasTestDatabase ? describe : describe.skip;

const START = new Date('2026-05-01T09:00:00.000Z');
const at = (minutes: number) => new Date(START.getTime() + minutes * 60_000);

suite('F3.2 · the solve timeline', () => {
  let ctx: TestContext;
  let userId: string;
  let otherUserId: string;
  let problemId: string;
  let sessionId: string;

  beforeAll(async () => {
    ctx = await setupTestDb();
  }, 60_000);

  afterAll(async () => {
    await ctx?.close();
  });

  beforeEach(async () => {
    await truncateAll(ctx.sql);

    userId = (await createUser(ctx.db, { email: 'timeline@example.com' })).id;
    otherUserId = (await createUser(ctx.db, { email: 'other@example.com' })).id;

    const [problem] = await ctx.db
      .insert(problems)
      .values({
        slug: 'timeline-fixture',
        title: 'Timeline fixture',
        sourceType: 'external_link',
        platform: 'leetcode',
        externalUrl: 'https://leetcode.com/problems/timeline-fixture/',
        difficulty: 'easy',
      })
      .returning();
    problemId = problem!.id;

    const [session] = await ctx.db
      .insert(solveSessions)
      .values({
        userId,
        problemId,
        startedAt: START,
        startedLocalDate: '2026-05-01',
      })
      .returning();
    sessionId = session!.id;
  });

  const capture = (overrides: Partial<Parameters<typeof captureSnapshot>[1]> = {}) =>
    captureSnapshot(ctx.db, {
      sessionId,
      userId,
      language: 'python3',
      source: 'print(1)\n',
      trigger: 'run_attempt',
      occurredAt: at(1),
      enabled: true,
      ...overrides,
    });

  const snapshotCount = async (): Promise<number> => {
    const rows = await ctx.db
      .select({ id: codeSnapshots.id })
      .from(codeSnapshots)
      .where(eq(codeSnapshots.sessionId, sessionId));
    return rows.length;
  };

  describe('the log is append-only, at the database', () => {
    it('REJECTS AN UPDATE, whatever issued it', async () => {
      await recordEvent(ctx.db, {
        sessionId,
        type: 'session_started',
        occurredAt: START,
      });

      /*
       * Raw SQL on purpose. Going through the service would only prove the
       * service does not update — the criterion is about the table, and this is
       * the statement a psql session or a future migration would run.
       */
      await expectDbRejection(
        ctx.db.execute(
          sql`update session_events set type = 'paused' where session_id = ${sessionId}`,
        ),
        /append-only/,
      );
    });

    it('REJECTS A DELETE too', async () => {
      await recordEvent(ctx.db, { sessionId, type: 'paused', occurredAt: at(1) });

      await expectDbRejection(
        ctx.db.execute(sql`delete from session_events where session_id = ${sessionId}`),
        /append-only/,
      );
    });

    it('POSITIVE CONTROL · an INSERT still works', async () => {
      /*
       * Without this, a trigger that rejected EVERY statement would pass both
       * assertions above — and an event log nothing can write to is a worse
       * bug than one that can be edited.
       */
      await recordEvent(ctx.db, { sessionId, type: 'first_keystroke', occurredAt: at(2) });

      const rows = await ctx.db
        .select({ id: sessionEvents.id })
        .from(sessionEvents)
        .where(eq(sessionEvents.sessionId, sessionId));

      expect(rows).toHaveLength(1);
    });

    it('refuses the update even inside a transaction that also inserts', async () => {
      // A mutation smuggled into a legitimate write path is still a mutation.
      await recordEvent(ctx.db, { sessionId, type: 'session_started', occurredAt: START });

      await expectDbRejection(
        ctx.db.transaction(async (tx) => {
          await recordEvent(tx, { sessionId, type: 'paused', occurredAt: at(1) });
          await tx.execute(sql`update session_events set type = 'resumed'`);
        }),
        /append-only/,
      );
    });

    it('carries a SQLSTATE a caller can branch on', async () => {
      await recordEvent(ctx.db, { sessionId, type: 'session_started', occurredAt: START });

      const error = await expectDbRejection(
        ctx.db.execute(sql`delete from session_events`),
        /append-only/,
      );

      // restrict_violation — not a generic P0001 that means "some plpgsql said no".
      expect(error.code).toBe('23001');
    });
  });

  describe('reconstruction', () => {
    /**
     * Thirty-one versions of a realistically sized file.
     *
     * The size matters, and the first version of this fixture got it wrong. A
     * two-line file makes the JSON diff LONGER than the source it describes, so
     * `captureSnapshot` re-bases to a full snapshot every time — correct
     * behaviour on a tiny file, and a fixture that proves nothing about
     * diffing. Real solutions are tens of lines.
     */
    function versions(): string[] {
      const base = [
        'class Solution:',
        '    def solve(self, nums: list[int], target: int) -> list[int]:',
        '        seen = {}',
        '        for index, value in enumerate(nums):',
        '            complement = target - value',
        '            if complement in seen:',
        '                return [seen[complement], index]',
        '            seen[value] = index',
        '        return []',
        '',
        '    def helper(self, nums):',
        '        total = 0',
        '        for value in nums:',
        '            total += value',
        '        return total',
        '',
      ];

      const out = [base.join('\n')];

      for (let step = 1; step <= 30; step += 1) {
        const lines = out.at(-1)!.split('\n');
        if (step % 3 === 0) lines.splice(3, 0, `        # step ${step}`);
        else if (step % 3 === 1) lines[2] = `        seen = {}  # ${step}`;
        else lines[11] = `        total = ${step}`;
        out.push(lines.join('\n'));
      }

      return out;
    }

    it('REBUILDS BYTE-IDENTICAL AT EVERY CHECKPOINT', async () => {
      const sources = versions();

      for (const [index, source] of sources.entries()) {
        await capture({
          source,
          trigger: 'run_attempt',
          occurredAt: at(index),
        });
      }

      const rebuilt = await reconstructSession(ctx.db, { userId, sessionId });
      expect(rebuilt).toHaveLength(sources.length);

      for (const [index, source] of sources.entries()) {
        expect(rebuilt[index]!.source, `checkpoint ${index}`).toBe(source);
      }
    });

    it('rebuilds one snapshot in the middle by id', async () => {
      const sources = versions();
      for (const [index, source] of sources.entries()) {
        await capture({ source, occurredAt: at(index) });
      }

      const all = await reconstructSession(ctx.db, { userId, sessionId });
      const middle = all[15]!;

      const single = await reconstruct(ctx.db, { userId, snapshotId: middle.snapshotId });
      expect(single?.source).toBe(sources[15]);
    });

    it('stores diffs, not thirty-one copies', async () => {
      const sources = versions();
      for (const [index, source] of sources.entries()) {
        await capture({ source, occurredAt: at(index) });
      }

      const rows = await ctx.db
        .select({ isFull: codeSnapshots.isFull, content: codeSnapshots.content })
        .from(codeSnapshots)
        .where(eq(codeSnapshots.sessionId, sessionId));

      const stored = rows.reduce((total, row) => total + row.content.length, 0);
      const naive = sources.reduce((total, source) => total + source.length, 0);

      // Only sequence 0 is full here; every later edit is small.
      expect(rows.filter((row) => row.isFull)).toHaveLength(1);
      expect(stored).toBeLessThan(naive / 2);
    });

    it("returns null for another user's snapshot rather than saying it exists", async () => {
      await capture();
      const [row] = await ctx.db.select({ id: codeSnapshots.id }).from(codeSnapshots).limit(1);

      expect(
        await reconstruct(ctx.db, { userId: otherUserId, snapshotId: row!.id }),
      ).toBeNull();
    });

    it('returns nothing for a session that is not the caller’s', async () => {
      await capture();
      expect(await reconstructSession(ctx.db, { userId: otherUserId, sessionId })).toEqual([]);
    });
  });

  describe('when a snapshot is taken', () => {
    it('always takes the first one, and stores it whole', async () => {
      const result = await capture({ trigger: 'interval' });
      expect(result).toEqual({ captured: true, sequence: 0, isFull: true });
    });

    it('SKIPS AN UNCHANGED SOURCE even on a run attempt', async () => {
      await capture({ source: 'same\n', occurredAt: at(0) });
      const second = await capture({ source: 'same\n', occurredAt: at(10) });

      expect(second).toEqual({ captured: false, reason: 'unchanged' });
      expect(await snapshotCount()).toBe(1);
    });

    it('holds an interval capture back inside the window', async () => {
      await capture({ source: 'a\n', occurredAt: at(0) });

      const tooSoon = await captureSnapshot(ctx.db, {
        sessionId,
        userId,
        language: 'python3',
        source: 'b\n',
        trigger: 'interval',
        occurredAt: new Date(at(0).getTime() + SNAPSHOT_INTERVAL_MS - 1),
        enabled: true,
      });

      expect(tooSoon).toEqual({ captured: false, reason: 'too_soon' });
      expect(await snapshotCount()).toBe(1);
    });

    it('takes an interval capture once the window has passed', async () => {
      await capture({ source: 'a\n', occurredAt: at(0) });

      const later = await captureSnapshot(ctx.db, {
        sessionId,
        userId,
        language: 'python3',
        source: 'b\n',
        trigger: 'interval',
        occurredAt: new Date(at(0).getTime() + SNAPSHOT_INTERVAL_MS),
        enabled: true,
      });

      expect(later.captured).toBe(true);
    });

    it('IGNORES THE WINDOW for a run attempt and a stuck marker', async () => {
      // These are the moments F3.3 will need to look at. Missing one loses the
      // evidence for a signal, which no interval rule is worth.
      await capture({ source: 'a\n', occurredAt: at(0) });

      const run = await capture({ source: 'b\n', occurredAt: new Date(at(0).getTime() + 500) });
      expect(run.captured).toBe(true);

      const stuck = await capture({
        source: 'c\n',
        trigger: 'stuck_marker',
        occurredAt: new Date(at(0).getTime() + 900),
      });
      expect(stuck.captured).toBe(true);
    });

    it('WRITES NOTHING WHEN CAPTURE IS TURNED OFF', async () => {
      const result = await capture({ enabled: false });

      expect(result).toEqual({ captured: false, reason: 'disabled' });
      expect(await snapshotCount()).toBe(0);
    });

    it('refuses a source larger than the cap', async () => {
      await expect(capture({ source: 'x'.repeat(70_000) })).rejects.toThrow(
        SnapshotTooLargeError,
      );
      expect(await snapshotCount()).toBe(0);
    });

    it('re-bases to a full snapshot when the diff would be bigger than the file', async () => {
      await capture({ source: 'a\nb\nc\nd\ne\n', occurredAt: at(0) });
      await capture({ source: 'totally different\n', occurredAt: at(1) });

      const rows = await ctx.db
        .select({ sequence: codeSnapshots.sequence, isFull: codeSnapshots.isFull })
        .from(codeSnapshots)
        .where(eq(codeSnapshots.sessionId, sessionId))
        .orderBy(codeSnapshots.sequence);

      expect(rows[1]!.isFull).toBe(true);

      // And it still reconstructs, which is the only thing re-basing must not break.
      const rebuilt = await reconstructSession(ctx.db, { userId, sessionId });
      expect(rebuilt[1]!.source).toBe('totally different\n');
    });
  });

  describe('elapsed is derived, and subtracts paused time', () => {
    it('reports active time rather than wall-clock', async () => {
      await recordEvent(ctx.db, { sessionId, type: 'session_started', occurredAt: at(0) });
      await recordEvent(ctx.db, { sessionId, type: 'paused', occurredAt: at(5) });
      await recordEvent(ctx.db, { sessionId, type: 'resumed', occurredAt: at(25) });
      await recordEvent(ctx.db, { sessionId, type: 'run_passed', occurredAt: at(30) });

      const timeline = await loadTimeline(ctx.db, {
        sessionId,
        startedAt: START,
        endedAt: at(30),
        now: at(30),
      });

      const elapsed = Object.fromEntries(
        timeline.map((event) => [event.type, event.elapsedMs]),
      );

      expect(elapsed['session_started']).toBe(0);
      expect(elapsed['paused']).toBe(5 * 60_000);
      // 25 wall minutes in, but 20 of them were paused.
      expect(elapsed['resumed']).toBe(5 * 60_000);
      expect(elapsed['run_passed']).toBe(10 * 60_000);
    });

    it('is unchanged by a duplicate pause event', async () => {
      /*
       * The property a stored counter cannot have, and the reason D20 removed
       * the duration column. Write the same pause twice and the derived answer
       * is identical; an incremented counter would be silently wrong forever,
       * in a table that forbids the correction.
       */
      const events = [
        { type: 'session_started' as const, occurredAt: at(0) },
        { type: 'paused' as const, occurredAt: at(5) },
        { type: 'paused' as const, occurredAt: at(6) },
        { type: 'resumed' as const, occurredAt: at(15) },
        { type: 'run_passed' as const, occurredAt: at(20) },
      ];

      const once = elapsedMsFor(
        { startedAt: START, endedAt: at(20), events: events.filter((_, i) => i !== 2) },
        at(20),
      );
      const twice = elapsedMsFor({ startedAt: START, endedAt: at(20), events }, at(20));

      expect([...twice.values()].at(-1)).toBe([...once.values()].at(-1));
    });

    it('orders by when things happened, not by when they were written', async () => {
      // An idle autopause is stamped at the last heartbeat — deliberately in
      // the past — so insertion order and event order genuinely differ.
      await recordEvent(ctx.db, { sessionId, type: 'session_started', occurredAt: at(0) });
      await recordEvent(ctx.db, { sessionId, type: 'session_abandoned', occurredAt: at(40) });
      await recordEvent(ctx.db, { sessionId, type: 'idle_autopause', occurredAt: at(10) });

      const timeline = await loadTimeline(ctx.db, {
        sessionId,
        startedAt: START,
        endedAt: at(40),
        now: at(40),
      });

      expect(timeline.map((event) => event.type)).toEqual([
        'session_started',
        'idle_autopause',
        'session_abandoned',
      ]);
    });
  });

  describe('retention and deletion', () => {
    it('DELETES EVERY SNAPSHOT AND EVENT FOR THE USER', async () => {
      await recordEvent(ctx.db, { sessionId, type: 'session_started', occurredAt: START });
      await capture({ source: 'a\n', occurredAt: at(0) });
      await capture({ source: 'b\n', occurredAt: at(1) });

      const removed = await deleteSolveHistory(ctx.db, { userId });
      expect(removed.snapshots).toBe(2);
      expect(removed.events).toBe(1);

      expect(await snapshotCount()).toBe(0);
      const events = await ctx.db
        .select({ id: sessionEvents.id })
        .from(sessionEvents)
        .where(eq(sessionEvents.sessionId, sessionId));
      expect(events).toHaveLength(0);
    });

    it('leaves the session itself, because that is a different deletion', async () => {
      await recordEvent(ctx.db, { sessionId, type: 'session_started', occurredAt: START });
      await deleteSolveHistory(ctx.db, { userId });

      const rows = await ctx.db
        .select({ id: solveSessions.id })
        .from(solveSessions)
        .where(eq(solveSessions.id, sessionId));

      // Removing it would silently rewrite the streak, the analytics and the
      // revision schedule — far more than "delete my solve history" asked for.
      expect(rows).toHaveLength(1);
    });

    it('THE LOG IS STILL APPEND-ONLY AFTERWARDS', async () => {
      /*
       * The flag is transaction-scoped. If it leaked — onto a pooled connection,
       * or by being set outside a transaction — the table would silently stop
       * being append-only after the first deletion, and nothing else in this
       * suite would notice.
       */
      await recordEvent(ctx.db, { sessionId, type: 'session_started', occurredAt: START });
      await deleteSolveHistory(ctx.db, { userId });
      await recordEvent(ctx.db, { sessionId, type: 'resumed', occurredAt: at(1) });

      await expectDbRejection(
        ctx.db.execute(sql`delete from session_events where session_id = ${sessionId}`),
        /append-only/,
      );
    });

    it("does not touch another user's history", async () => {
      const [otherSession] = await ctx.db
        .insert(solveSessions)
        .values({
          userId: otherUserId,
          problemId,
          startedAt: START,
          startedLocalDate: '2026-05-01',
        })
        .returning();

      await recordEvent(ctx.db, {
        sessionId: otherSession!.id,
        type: 'session_started',
        occurredAt: START,
      });
      await captureSnapshot(ctx.db, {
        sessionId: otherSession!.id,
        userId: otherUserId,
        language: 'python3',
        source: 'theirs\n',
        trigger: 'run_attempt',
        occurredAt: at(0),
        enabled: true,
      });

      await deleteSolveHistory(ctx.db, { userId });

      const theirs = await ctx.db
        .select({ id: codeSnapshots.id })
        .from(codeSnapshots)
        .where(eq(codeSnapshots.userId, otherUserId));
      expect(theirs).toHaveLength(1);
    });

    it('deletes one session without touching the rest', async () => {
      /*
       * Finished, not live. `solve_sessions_one_live_per_user` (F1.4) permits a
       * user exactly one live session, so a fixture with two active ones is
       * testing against a state the product cannot reach.
       */
      const [second] = await ctx.db
        .insert(solveSessions)
        .values({
          userId,
          problemId,
          status: 'solved',
          startedAt: START,
          endedAt: at(30),
          startedLocalDate: '2026-05-01',
          endedLocalDate: '2026-05-01',
        })
        .returning();

      await capture({ source: 'first\n' });
      await captureSnapshot(ctx.db, {
        sessionId: second!.id,
        userId,
        language: 'python3',
        source: 'second\n',
        trigger: 'run_attempt',
        occurredAt: at(0),
        enabled: true,
      });

      const removed = await deleteSessionHistory(ctx.db, { userId, sessionId });
      expect(removed?.snapshots).toBe(1);

      const survivors = await ctx.db
        .select({ id: codeSnapshots.id })
        .from(codeSnapshots)
        .where(eq(codeSnapshots.sessionId, second!.id));
      expect(survivors).toHaveLength(1);
    });

    it("refuses a session that is not the caller's", async () => {
      await capture();
      expect(await deleteSessionHistory(ctx.db, { userId: otherUserId, sessionId })).toBeNull();
      expect(await snapshotCount()).toBe(1);
    });

    it('purges snapshots past the retention window and keeps the rest', async () => {
      await capture({ source: 'kept\n' });

      // Backdate one row past 90 days. `created_at` is what retention reads —
      // it is when we stored it, which is the promise being kept.
      await ctx.db.execute(
        sql`update code_snapshots set created_at = now() - interval '91 days'`,
      );
      await capture({ source: 'fresh\n', occurredAt: at(5) });

      const result = await purgeExpiredSnapshots(ctx.db, new Date());
      expect(result.deleted).toBe(1);
      expect(await snapshotCount()).toBe(1);
    });

    it('POSITIVE CONTROL · the purge leaves a young snapshot alone', async () => {
      // Otherwise a purge that deleted everything would also pass above.
      await capture({ source: 'young\n' });

      const result = await purgeExpiredSnapshots(ctx.db, new Date());
      expect(result.deleted).toBe(0);
      expect(await snapshotCount()).toBe(1);
    });
  });
});
