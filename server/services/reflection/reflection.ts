/**
 * The post-solve reflection.
 *
 * Optional by design — the ticket says "skippable but nudged" — and the absence
 * of a row is therefore meaningful. A skipped reflection is not the same fact as
 * a reflection saying nothing went wrong, and nothing downstream may read them
 * the same way: the second is `mistakes: ['none']`, the first is no row at all.
 */
import { and, eq } from 'drizzle-orm';
import type { Database } from '@/server/db';
import {
  reflectionMistakes,
  reflectionStuckAreas,
  reflections,
  solveSessions,
  userProblems,
} from '@/server/db/schema';
import type { MistakeCategory, StuckCategory } from '@/lib/reflection/taxonomy';
import { loadOwnedSession } from '@/server/services/session';
import { SessionNotReflectableError } from './errors';

import type { Confidence } from '@/lib/session/confidence';

/* Re-exported so existing importers keep their path; declared in lib/ so
   client components can reach it without crossing the server boundary. */
export type { Confidence };

export type ReflectionView = {
  sessionId: string;
  approach: string | null;
  achievedComplexity: string | null;
  stuckAreas: StuckCategory[];
  mistakes: MistakeCategory[];
  confidence: Confidence | null;
};

/**
 * Write (or rewrite) the reflection for a finished session.
 *
 * A re-submit edits the existing row rather than adding a second account of the
 * same solve, and the child rows are replaced wholesale — unticking a box has to
 * remove it, which a pure insert cannot express.
 */
export async function saveReflection(
  db: Database,
  input: {
    userId: string;
    sessionId: string;
    approach?: string;
    achievedComplexity?: string;
    stuckAreas?: readonly StuckCategory[];
    mistakes?: readonly MistakeCategory[];
    confidence?: Confidence;
    now: Date;
  },
): Promise<ReflectionView> {
  const { userId, sessionId, confidence, now } = input;

  const session = await loadOwnedSession(db, sessionId, userId);
  assertReflectable(session.status);

  const approach = trimmed(input.approach);
  const achievedComplexity = trimmed(input.achievedComplexity);
  const stuckAreas = unique(input.stuckAreas ?? []);
  const mistakes = unique(input.mistakes ?? []);

  await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(reflections)
      .values({ sessionId, approach, achievedComplexity })
      // Targeted per D16: the only conflict this absorbs is "this session has
      // been reflected on before", which is an edit, not a race.
      .onConflictDoUpdate({
        target: reflections.sessionId,
        set: { approach, achievedComplexity, updatedAt: now },
      })
      .returning({ id: reflections.id });

    const reflectionId = row!.id;

    /*
     * Replace, do not append. The child rows are the current answer to a
     * multi-select, so a category the user has just unticked must disappear —
     * and inserting only what is new would leave it there forever.
     */
    await tx
      .delete(reflectionStuckAreas)
      .where(eq(reflectionStuckAreas.reflectionId, reflectionId));
    await tx
      .delete(reflectionMistakes)
      .where(eq(reflectionMistakes.reflectionId, reflectionId));

    if (stuckAreas.length > 0) {
      await tx
        .insert(reflectionStuckAreas)
        .values(stuckAreas.map((category) => ({ reflectionId, category })));
    }

    if (mistakes.length > 0) {
      await tx
        .insert(reflectionMistakes)
        .values(mistakes.map((category) => ({ reflectionId, category })));
    }

    if (confidence) {
      /*
       * Confidence has one home — `solve_sessions` (F1.4) — and `user_problems`
       * mirrors the latest answer for the catalog to show. Both are written
       * here so that answering the question late cannot leave the two saying
       * different things about the same solve.
       */
      await tx
        .update(solveSessions)
        .set({ confidence, updatedAt: now })
        .where(eq(solveSessions.id, sessionId));

      await tx
        .update(userProblems)
        .set({ confidence, updatedAt: now })
        .where(
          and(eq(userProblems.userId, userId), eq(userProblems.problemId, session.problemId)),
        );
    }
  });

  return {
    sessionId,
    approach,
    achievedComplexity,
    stuckAreas,
    mistakes,
    confidence: confidence ?? session.confidence,
  };
}

/** The reflection for a session, or null when it was skipped. */
export async function getReflection(
  db: Database,
  input: { userId: string; sessionId: string },
): Promise<ReflectionView | null> {
  const session = await loadOwnedSession(db, input.sessionId, input.userId);

  const [row] = await db
    .select()
    .from(reflections)
    .where(eq(reflections.sessionId, input.sessionId))
    .limit(1);

  if (!row) return null;

  const [areas, mistakes] = await Promise.all([
    db
      .select({ category: reflectionStuckAreas.category })
      .from(reflectionStuckAreas)
      .where(eq(reflectionStuckAreas.reflectionId, row.id)),
    db
      .select({ category: reflectionMistakes.category })
      .from(reflectionMistakes)
      .where(eq(reflectionMistakes.reflectionId, row.id)),
  ]);

  return {
    sessionId: input.sessionId,
    approach: row.approach,
    achievedComplexity: row.achievedComplexity,
    stuckAreas: areas.map((area) => area.category),
    mistakes: mistakes.map((mistake) => mistake.category),
    confidence: session.confidence,
  };
}

/**
 * Reflection belongs to a session the user finished with an outcome.
 *
 * Abandoned is excluded for the same reason it is not an attempt (D20) — the
 * sweep abandons sessions on the user's behalf, so a reflection attached to one
 * would be a considered account of a solve that never concluded.
 */
function assertReflectable(status: string): void {
  if (status !== 'solved' && status !== 'stuck') {
    throw new SessionNotReflectableError(status);
  }
}

const trimmed = (value: string | undefined): string | null => {
  const text = value?.trim();
  return text?.length ? text : null;
};

const unique = <T>(values: readonly T[]): T[] => [...new Set(values)];
