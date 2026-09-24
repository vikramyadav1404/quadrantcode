/**
 * The solve-session lifecycle. **The server owns every timestamp.**
 *
 * Every function here takes `now` as a parameter and the adapters above pass
 * `new Date()`. No input schema anywhere accepts a time or a duration, which is
 * what makes the adversarial test possible: forge whatever you like, the fields
 * do not exist and the computed value does not move.
 *
 * `now` is a parameter for the same reason `today` is one in the streak engine
 * (D18): a lifecycle that reads the clock cannot be tested across a five-minute
 * idle gap or a seven-hour abandonment without changing the machine's time.
 */
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type { Database, Transaction } from '@/server/db';
import { problems, solveSessions, userProblems } from '@/server/db/schema';
import { creditSolvedDay, localDateFor, recomputeStreak } from '@/server/services/streak';
import { scheduleAfterSolveTx } from '@/server/services/revision';
// The pure module only: the modes SERVICE starts sessions through this file, so
// importing it here would be a cycle.
import { speedTargetMet } from '@/server/services/revision/modes/target';
import type { RevisionMode } from '@/lib/revision/modes';
import { countStuckAttempts } from './signals';
import { activeDurationSeconds, isPausedAt } from './duration';
import { ActiveSessionExistsError, SessionNotFoundError } from './errors';
import { loadEvents, recordEvent } from './events';
import {
  LIVE_STATUSES,
  type SessionStatus,
  type TerminalStatus,
  assertTransition,
} from './state';
import { abandonIfStale, applyIdleAutopause } from './sweep';

import type { Confidence } from '@/lib/session/confidence';

/* Re-exported so existing importers keep their path; declared in lib/ so
   client components can reach it without crossing the server boundary. */
export type { Confidence };

/** What a caller gets back. There is no duration field on the row it came from. */
export type SessionView = {
  id: string;
  problemId: string;
  status: SessionStatus;
  startedAt: Date;
  endedAt: Date | null;
  /** Computed from the event log on every read — never stored, never sent by a client. */
  activeDurationSeconds: number;
  isPaused: boolean;
  confidence: Confidence | null;
  /** F2.2 · null for an ordinary solve. */
  revisionMode: RevisionMode | null;
  /** F2.2 · set for speed sittings only. */
  speedTargetSeconds: number | null;
};

type SessionRow = typeof solveSessions.$inferSelect;

/** Everything a caller may supply. Note what is absent: any notion of time. */
type Actor = { userId: string; timeZone: string; now: Date };

/**
 * One session, or a not-found the caller cannot distinguish from "not yours".
 *
 * Exported because F1.5 attaches to sessions and must apply the same ownership
 * rule. Two implementations of "is this session yours" is one too many: the
 * second one is where the IDOR gets in.
 */
export async function loadOwnedSession(
  db: Database,
  sessionId: string,
  userId: string,
): Promise<SessionRow> {
  return loadOwned(db, sessionId, userId);
}

async function loadOwned(db: Database, sessionId: string, userId: string): Promise<SessionRow> {
  const [row] = await db
    .select()
    .from(solveSessions)
    .where(and(eq(solveSessions.id, sessionId), eq(solveSessions.userId, userId)))
    .limit(1);

  // Same error whether it does not exist or is someone else's — see errors.ts.
  if (!row) throw new SessionNotFoundError();
  return row;
}

async function toView(db: Database, row: SessionRow, now: Date): Promise<SessionView> {
  const events = await loadEvents(db, row.id);
  const input = { startedAt: row.startedAt, endedAt: row.endedAt, events };

  return {
    id: row.id,
    problemId: row.problemId,
    status: row.status,
    startedAt: row.startedAt,
    endedAt: row.endedAt,
    activeDurationSeconds: activeDurationSeconds(input, now),
    isPaused: row.endedAt === null && isPausedAt(input, now),
    confidence: row.confidence,
    revisionMode: row.revisionMode,
    speedTargetSeconds: row.speedTargetSeconds,
  };
}

/** The user's live session, if they have one. At most one exists by construction. */
async function findLive(db: Database, userId: string): Promise<SessionRow | undefined> {
  const [row] = await db
    .select()
    .from(solveSessions)
    .where(
      and(eq(solveSessions.userId, userId), inArray(solveSessions.status, [...LIVE_STATUSES])),
    )
    .orderBy(desc(solveSessions.startedAt))
    .limit(1);

  return row;
}

/**
 * The live session as it should be RIGHT NOW — swept and autopaused first.
 *
 * This is the request-path sweep. It costs no extra query in the common case
 * because the session had to be loaded anyway, which is why the shell can call
 * it on every page without a scheduler existing (D17).
 */
async function resolveLive(db: Database, actor: Actor): Promise<SessionRow | undefined> {
  const live = await findLive(db, actor.userId);
  if (!live) return undefined;

  if (await abandonIfStale(db, { ...live, timeZone: actor.timeZone }, actor.now)) {
    return undefined; // it is terminal now; the user has no live session
  }

  if (await applyIdleAutopause(db, live, actor.now)) {
    return findLive(db, actor.userId); // re-read: the status changed underneath us
  }

  return live;
}

/**
 * Begin a session on a problem.
 *
 * Refuses — with the existing session attached — if one is already live. The
 * ticket's wording is "prompts to finish or abandon the existing one, never
 * silently reassign", and reassigning is exactly what a friendly-looking
 * `onConflictDoUpdate` here would do.
 */
export async function startSession(
  db: Database,
  input: Actor & {
    problemId: string;
    /**
     * F2.2 · set only by the revision-modes service, which decides the mode's
     * eligibility and computes the speed target. Never from a client directly.
     */
    revision?: { mode: RevisionMode; speedTargetSeconds: number | null };
  },
): Promise<SessionView> {
  const { userId, problemId, timeZone, now, revision } = input;

  const live = await resolveLive(db, input);
  if (live) {
    throw new ActiveSessionExistsError({
      id: live.id,
      problemId: live.problemId,
      status: live.status,
    });
  }

  const row = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(solveSessions)
      .values({
        userId,
        problemId,
        startedAt: now,
        lastHeartbeatAt: now,
        startedLocalDate: localDateFor(now, timeZone),
        revisionMode: revision?.mode ?? null,
        speedTargetSeconds: revision?.mode === 'speed' ? revision.speedTargetSeconds : null,
      })
      .returning();

    await recordEvent(tx, {
      sessionId: created!.id,
      type: 'session_started',
      occurredAt: now,
    });

    return created!;
  });

  return toView(db, row, now);
}

/** Pause a running session. Pausing a paused one is an illegal transition, not a no-op. */
export async function pauseSession(
  db: Database,
  input: Actor & { sessionId: string },
): Promise<SessionView> {
  return transition(db, input, 'paused', 'paused');
}

/** Resume a paused session. */
export async function resumeSession(
  db: Database,
  input: Actor & { sessionId: string },
): Promise<SessionView> {
  return transition(db, input, 'active', 'resumed');
}

/** Shared by pause and resume: assert, update, append the event. */
async function transition(
  db: Database,
  input: Actor & { sessionId: string },
  to: 'active' | 'paused',
  event: 'paused' | 'resumed',
): Promise<SessionView> {
  const row = await loadOwned(db, input.sessionId, input.userId);
  assertTransition(row.status, to);

  const updated = await db.transaction(async (tx) => {
    const [next] = await tx
      .update(solveSessions)
      .set({ status: to, updatedAt: input.now })
      .where(and(eq(solveSessions.id, row.id), eq(solveSessions.status, row.status)))
      .returning();

    // Lost a race with the sweep or another tab. The session moved on without
    // us; report it as it now is rather than pretending this call landed.
    if (!next) return undefined;

    await recordEvent(tx, {
      sessionId: row.id,
      type: event,
      occurredAt: input.now,
    });

    return next;
  });

  return toView(db, updated ?? (await loadOwned(db, input.sessionId, input.userId)), input.now);
}

/**
 * Record a heartbeat. The only thing a running client sends, and it carries no
 * payload at all — its whole content is "I am still here", stamped server-side.
 *
 * A heartbeat for a session that is not active is ignored rather than rejected:
 * a client that pauses in one tab while another is mid-heartbeat is racing
 * itself, not doing something wrong.
 */
export async function heartbeat(
  db: Database,
  input: Actor & { sessionId: string },
): Promise<SessionView> {
  const row = await loadOwned(db, input.sessionId, input.userId);

  if (row.status === 'active') {
    await db
      .update(solveSessions)
      .set({ lastHeartbeatAt: input.now, updatedAt: input.now })
      .where(and(eq(solveSessions.id, row.id), eq(solveSessions.status, 'active')));

    return toView(db, { ...row, lastHeartbeatAt: input.now }, input.now);
  }

  return toView(db, row, input.now);
}

/**
 * Finish a session with an outcome the user chose.
 *
 * `solved` and `stuck` are both attempts — the user worked and formed a view.
 * `abandoned` is not, which is why it has its own function.
 */
export async function completeSession(
  db: Database,
  input: Actor & {
    sessionId: string;
    outcome: 'solved' | 'stuck';
    confidence?: Confidence;
  },
): Promise<SessionView> {
  const { userId, sessionId, outcome, confidence, timeZone, now } = input;

  const row = await loadOwned(db, sessionId, userId);
  assertTransition(row.status, outcome);

  const endedLocalDate = localDateFor(now, timeZone);
  const events = await loadEvents(db, sessionId);
  const seconds = activeDurationSeconds(
    { startedAt: row.startedAt, endedAt: now, events },
    now,
  );

  await db.transaction(async (tx) => {
    const [next] = await tx
      .update(solveSessions)
      .set({
        status: outcome,
        endedAt: now,
        endedLocalDate,
        confidence: confidence ?? null,
        // F2.2 · hit or miss is decided here, from the same event-derived
        // duration the attempt records, so the two cannot disagree.
        speedTargetMet:
          row.revisionMode === 'speed' && row.speedTargetSeconds !== null
            ? speedTargetMet({
                outcome,
                activeSeconds: seconds,
                targetSeconds: row.speedTargetSeconds,
              })
            : null,
        updatedAt: now,
      })
      .where(
        and(eq(solveSessions.id, sessionId), inArray(solveSessions.status, [...LIVE_STATUSES])),
      )
      .returning({ id: solveSessions.id });

    if (!next) return; // swept out from under us; do not double-count anything

    await recordEvent(tx, {
      sessionId,
      type: 'session_completed',
      occurredAt: now,
      payload: { outcome, confidence: confidence ?? null, activeDurationSeconds: seconds },
    });

    await recordAttempt(tx, {
      userId,
      problemId: row.problemId,
      outcome,
      confidence,
      seconds,
      now,
    });

    if (outcome === 'solved') {
      await creditSolvedDay(tx, { userId, localDate: endedLocalDate, timeZone, now });

      /*
       * Schedule the revision inside the same transaction (F2.1).
       *
       * Not afterwards, and not in the action: a completed solve whose revision
       * was never scheduled is a problem that silently never comes back, and
       * unlike the streak recompute below there is nothing that would notice
       * and repair it later.
       */
      await scheduleAfterSolveTx(tx, {
        userId,
        problemId: row.problemId,
        today: endedLocalDate,
        signals: {
          confidence: confidence ?? null,
          // F3.4 is cut, so nothing produces a hint; the signal is inert.
          hintsUsed: 0,
          failedAttempts: await countStuckAttempts(tx, userId, row.problemId),
          activeSeconds: seconds,
          estimatedSeconds: await estimatedSecondsFor(tx, row.problemId),
        },
      });
    }
  });

  /*
   * The recompute runs OUTSIDE the transaction, and it is allowed to fail.
   *
   * `user_streaks` is derived (D18) and the shell recomputes on read (D19), so
   * the worst case is a badge that is briefly stale and repairs itself on the
   * next page load. Holding the transaction open across it would widen the lock
   * on the primary records — the session and the attempt — for the sake of a
   * cache that heals itself.
   */
  if (outcome === 'solved') {
    await recomputeStreak(db, userId, endedLocalDate);
  }

  return toView(db, await loadOwned(db, sessionId, userId), now);
}

/**
 * Give up on a session without claiming an outcome.
 *
 * **Does not touch `user_problems`.** An attempt is something the user finished
 * making a claim about; abandonment is the opposite of that, and the sweep
 * abandons sessions on the user's behalf. Counting those as attempts would
 * inflate `total_attempts` for people who simply closed a tab, and F1.5 renders
 * that history.
 */
export async function abandonSession(
  db: Database,
  input: Actor & { sessionId: string },
): Promise<SessionView> {
  const { userId, sessionId, timeZone, now } = input;

  const row = await loadOwned(db, sessionId, userId);
  assertTransition(row.status, 'abandoned');

  await db.transaction(async (tx) => {
    const [next] = await tx
      .update(solveSessions)
      .set({
        status: 'abandoned',
        endedAt: now,
        endedLocalDate: localDateFor(now, timeZone),
        updatedAt: now,
      })
      .where(
        and(eq(solveSessions.id, sessionId), inArray(solveSessions.status, [...LIVE_STATUSES])),
      )
      .returning({ id: solveSessions.id });

    if (!next) return;

    await recordEvent(tx, {
      sessionId,
      type: 'session_abandoned',
      occurredAt: now,
      payload: { reason: 'user' },
    });
  });

  return toView(db, await loadOwned(db, sessionId, userId), now);
}

/**
 * What the shell renders: the user's live session, or nothing.
 *
 * Sweeps and autopauses first, so the timer bar never shows a session the user
 * walked away from six hours ago as if it were still running.
 */
export async function getActiveSession(
  db: Database,
  actor: Actor,
): Promise<SessionView | null> {
  const live = await resolveLive(db, actor);
  return live ? toView(db, live, actor.now) : null;
}

/** One problem's running totals, updated by a finished attempt. */
async function recordAttempt(
  tx: Transaction,
  input: {
    userId: string;
    problemId: string;
    outcome: 'solved' | 'stuck';
    confidence?: Confidence;
    seconds: number;
    now: Date;
  },
): Promise<void> {
  const { userId, problemId, outcome, confidence, seconds, now } = input;
  const solved = outcome === 'solved';

  /*
   * At least one second, because `user_problems_best_time_positive` requires
   * `best_time_seconds > 0` and the duration arithmetic floors to whole
   * seconds — so a solve that took 900ms arrives here as 0 and the insert is
   * rejected by the database.
   *
   * Found by an e2e test that started a session and pressed "Solved"
   * immediately, which every service test had missed because they all set
   * `now` twenty minutes ahead. It is a real path: a user re-solving something
   * they already know, or clicking through to record a solve done elsewhere.
   *
   * Rounding up rather than storing null keeps "they have a best time" true.
   * The overstatement is under a second, on a column whose unit is seconds.
   */
  const bestSeconds = Math.max(1, seconds);

  /*
   * An ISO string with an explicit cast, not the Date.
   *
   * Inside a raw `sql` fragment drizzle hands the value straight to the driver
   * without the column's encoder, and postgres.js rejects a Date there —
   * "the string argument must be of type string, received an instance of Date".
   * The typed builder above (`.values({...})`) is unaffected, which is why the
   * failure only appears in the ON CONFLICT half.
   */
  const nowSql = sql`${now.toISOString()}::timestamptz`;

  await tx
    .insert(userProblems)
    .values({
      userId,
      problemId,
      status: solved ? 'solved' : 'stuck',
      firstSolvedAt: solved ? now : null,
      lastAttemptedAt: now,
      totalAttempts: 1,
      bestTimeSeconds: solved ? bestSeconds : null,
      confidence: confidence ?? null,
    })
    // Targeted per D16: the only conflict this absorbs is "the user has
    // attempted this problem before", which is the normal case, not a race.
    .onConflictDoUpdate({
      target: [userProblems.userId, userProblems.problemId],
      set: {
        /*
         * A later stuck sitting never un-solves a problem. Solving it is a fact
         * about the past; struggling with it again does not undo that, and a
         * catalog that flips back to "stuck" would lose it silently.
         */
        status: solved
          ? 'solved'
          : sql`case when ${userProblems.status} = 'solved' then 'solved'::user_problem_status
                 else 'stuck'::user_problem_status end`,

        // First solve keeps its original date; later solves do not overwrite it.
        ...(solved
          ? { firstSolvedAt: sql`coalesce(${userProblems.firstSolvedAt}, ${nowSql})` }
          : {}),

        // Best ACTIVE time, and only a solve can set it — a stuck sitting is
        // not a time to beat.
        ...(solved
          ? {
              bestTimeSeconds: sql`least(coalesce(${userProblems.bestTimeSeconds}, ${bestSeconds}), ${bestSeconds})`,
            }
          : {}),

        ...(confidence ? { confidence } : {}),

        lastAttemptedAt: now,
        totalAttempts: sql`${userProblems.totalAttempts} + 1`,
        updatedAt: now,
      },
    });
}
/** The problem's own estimate, which the "slow solve" signal compares against. */
async function estimatedSecondsFor(tx: Transaction, problemId: string): Promise<number> {
  const [row] = await tx
    .select({ estimatedMinutes: problems.estimatedMinutes })
    .from(problems)
    .where(eq(problems.id, problemId))
    .limit(1);

  return (row?.estimatedMinutes ?? 0) * 60;
}

/**
 * Credit the day the solve landed on.
 *
 * Two statements rather than one clever upsert, deliberately: `completed` is
 * decided by `evaluateDayCompletion`, and `rules.ts` is explicit that nothing
 * outside it may re-implement that comparison. Expressing the rule in SQL here
 * would put a second copy of it in the codebase — the exact drift that makes a
 * streak disagree with the heatmap beside it.
 */
export type { TerminalStatus };
