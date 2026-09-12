/**
 * Writing inferences into `stuck_points`, and letting the user answer them.
 *
 * ## Same table as the user's own markers, on purpose
 *
 * F1.5 put `source` on this table with the comment that F3.3 would infer into
 * it — and the criterion is that confirmed and inferred be "separable in a
 * single SQL query", which one column and one table makes trivially true.
 *
 * ## `source` and `status` are different questions
 *
 * `source` is who proposed it: the user, or us. `status` is whether the user
 * agreed. An inference they confirmed stays `inferred` in origin and becomes
 * `confirmed` in standing — and it is the standing that decides weight
 * downstream, so a confirmed inference counts exactly as much as something the
 * user typed. That is the point of asking them.
 *
 * ## Re-running is idempotent, and never overwrites an answer
 *
 * Inference can run again — after more snapshots, or because the signals
 * changed. Rows the user has already confirmed or dismissed are left alone.
 * Re-proposing something somebody dismissed would be this feature arguing with
 * them, and re-writing something they confirmed would discard the evidence they
 * agreed to (which is why `evidence` is stored, not recomputed).
 */
import { and, eq, inArray } from 'drizzle-orm';
import type { Database, Transaction } from '@/server/db';
import { solveSessions, stuckPoints } from '@/server/db/schema';
import type { StuckRegion } from './types';

export class StuckPointNotFoundError extends Error {
  readonly status = 404;

  constructor() {
    // Deliberately says nothing about whether the id exists.
    super('No such stuck point.');
    this.name = 'StuckPointNotFoundError';
  }
}

/**
 * Replace this session's UNANSWERED inferences with a fresh set.
 *
 * Delete-and-rewrite, like F1.6's rollups, and for the same reason: "running it
 * twice produces one set of rows" is true by construction rather than by
 * careful upserting. The delete is narrowed to `status = 'inferred'`, which is
 * what protects the user's answers.
 */
export async function saveInferences(
  db: Database,
  input: { userId: string; sessionId: string; regions: readonly StuckRegion[] },
): Promise<number> {
  const [session] = await db
    .select({ id: solveSessions.id })
    .from(solveSessions)
    .where(and(eq(solveSessions.id, input.sessionId), eq(solveSessions.userId, input.userId)))
    .limit(1);

  if (!session) return 0;

  /*
   * User markers are already rows in this table — F1.5 wrote them. The ranking
   * includes them so the UI gets one ordered list, but writing them back would
   * duplicate every marker on every re-run.
   */
  const inferred = input.regions.filter((region) => region.confidence !== 'user_marked');

  return db.transaction(async (tx) => {
    await tx
      .delete(stuckPoints)
      .where(
        and(
          eq(stuckPoints.sessionId, input.sessionId),
          eq(stuckPoints.source, 'inferred'),
          eq(stuckPoints.status, 'inferred'),
        ),
      );

    if (inferred.length === 0) return 0;

    await tx.insert(stuckPoints).values(
      inferred.map((region) => ({
        sessionId: input.sessionId,
        // Null, always. Timing and locality cannot tell understanding from
        // syntax, and the CHECK only requires a category for user rows.
        category: null,
        elapsedSeconds: region.startedSeconds,
        source: 'inferred' as const,
        status: 'inferred' as const,
        confidence: region.confidence,
        lineStart: region.lineStart,
        lineEnd: region.lineEnd,
        startedSeconds: region.startedSeconds,
        endedSeconds: region.endedSeconds,
        evidence: region.evidence,
      })),
    );

    return inferred.length;
  });
}

/** What the user can do with an inference. */
export type StuckAnswer =
  | { action: 'confirm' }
  | { action: 'dismiss' }
  | { action: 'adjust'; lineStart: number; lineEnd: number };

/**
 * Record the user's answer to one inference.
 *
 * Scoped through the session to the owner, so another user's row is a 404 and
 * not a 403 — the same rule every read in this project follows.
 *
 * Adjusting also confirms. Someone who takes the trouble to correct the range
 * has agreed there was a stuck point; asking them to press two buttons for one
 * judgement would be the form getting in the way of the answer.
 */
export async function answerStuckPoint(
  db: Database,
  input: { userId: string; stuckPointId: string; answer: StuckAnswer; now: Date },
): Promise<void> {
  const owned = db
    .select({ id: solveSessions.id })
    .from(solveSessions)
    .where(eq(solveSessions.userId, input.userId));

  const updated = await db
    .update(stuckPoints)
    .set({
      status: input.answer.action === 'dismiss' ? 'dismissed' : 'confirmed',
      ...(input.answer.action === 'adjust'
        ? { lineStart: input.answer.lineStart, lineEnd: input.answer.lineEnd }
        : {}),
      updatedAt: input.now,
    })
    .where(
      and(
        eq(stuckPoints.id, input.stuckPointId),
        // Only an inference can be answered. A marker the user typed is already
        // their own statement, and "confirming" it would be meaningless.
        eq(stuckPoints.source, 'inferred'),
        inArray(stuckPoints.sessionId, owned),
      ),
    )
    .returning({ id: stuckPoints.id });

  if (updated.length === 0) throw new StuckPointNotFoundError();
}

/** Every stuck point for a session, the user's and ours, in one query. */
export async function loadStuckPoints(
  reader: Database | Transaction,
  input: { userId: string; sessionId: string },
) {
  const owned = reader
    .select({ id: solveSessions.id })
    .from(solveSessions)
    .where(and(eq(solveSessions.id, input.sessionId), eq(solveSessions.userId, input.userId)));

  return reader
    .select({
      id: stuckPoints.id,
      source: stuckPoints.source,
      status: stuckPoints.status,
      confidence: stuckPoints.confidence,
      category: stuckPoints.category,
      lineStart: stuckPoints.lineStart,
      lineEnd: stuckPoints.lineEnd,
      startedSeconds: stuckPoints.startedSeconds,
      endedSeconds: stuckPoints.endedSeconds,
      elapsedSeconds: stuckPoints.elapsedSeconds,
      evidence: stuckPoints.evidence,
      note: stuckPoints.note,
    })
    .from(stuckPoints)
    .where(inArray(stuckPoints.sessionId, owned))
    .orderBy(stuckPoints.elapsedSeconds);
}
