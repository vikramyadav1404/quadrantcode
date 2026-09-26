/**
 * F2.2 · starting a revision sitting, and what each mode shows during one.
 *
 * ## Why this is not in `revision/index.ts`
 *
 * It starts sessions through the session lifecycle, and the lifecycle already
 * imports the revision engine to schedule after a solve. Exporting this from
 * the engine's index would close that loop into a cycle, so it has its own
 * entry point: `@/server/services/revision/modes`.
 *
 * ## Blind retry is enforced here, by omission
 *
 * `sittingView` for a blind sitting returns `{ mode: 'blind' }` and nothing
 * else — no history, no notes, no code. The solve page renders what this
 * returns, and the ticket's rule is that previous code must not reach the
 * client at all. The cheapest way to guarantee something is absent from a
 * payload is never to load it.
 */
import { and, asc, desc, eq, inArray, ne } from 'drizzle-orm';
import type { Database } from '@/server/db';
import {
  problemTags,
  problems,
  reflectionMistakes,
  reflections,
  revisionSchedule,
  solveSessions,
  userProblems,
} from '@/server/db/schema';
import { MISTAKE_CATEGORY_LABELS, STUCK_CATEGORY_LABELS } from '@/lib/reflection/taxonomy';
import type {
  ModeComparisonView,
  RevisionMode,
  RevisionSittingView,
} from '@/lib/revision/modes';
import { originalsVisible } from '@/server/services/problems/queries';
import { getAttemptHistory } from '@/server/services/reflection';
import { type SessionView, startSession } from '@/server/services/session';
import { compareModes, measureRevisions } from './comparison';
import { speedTargetSeconds } from './target';

/** Revising something means it was solved and scheduled first. */
export class NotScheduledForRevisionError extends Error {
  readonly code = 'NOT_SCHEDULED_FOR_REVISION' as const;
  constructor() {
    super('That problem is not scheduled for revision. Solve it first.');
    this.name = 'NotScheduledForRevisionError';
  }
}

/** How many related problems a pattern sitting offers. The ticket says 2–3. */
const PATTERN_SET_SIZE = 3;

/**
 * Begin a sitting in a revision mode.
 *
 * The same one-live-session rule as any solve applies — `startSession` raises
 * `ActiveSessionExistsError` and the caller maps it — so a revision cannot be
 * a way round it.
 */
export async function startRevisionSitting(
  db: Database,
  input: { userId: string; timeZone: string; now: Date; problemId: string; mode: RevisionMode },
): Promise<SessionView> {
  const { userId, problemId, mode } = input;

  const [scheduled] = await db
    .select({ problemId: revisionSchedule.problemId })
    .from(revisionSchedule)
    .where(and(eq(revisionSchedule.userId, userId), eq(revisionSchedule.problemId, problemId)))
    .limit(1);
  // Same answer for "never solved" and "someone else's problem id": neither is
  // the caller's to distinguish (the F1.4 not-found rule).
  if (!scheduled) throw new NotScheduledForRevisionError();

  let target: number | null = null;
  if (mode === 'speed') {
    const [row] = await db
      .select({
        estimatedMinutes: problems.estimatedMinutes,
        bestTimeSeconds: userProblems.bestTimeSeconds,
      })
      .from(problems)
      .leftJoin(
        userProblems,
        and(eq(userProblems.problemId, problems.id), eq(userProblems.userId, userId)),
      )
      .where(eq(problems.id, problemId))
      .limit(1);
    if (!row) throw new NotScheduledForRevisionError();
    target = speedTargetSeconds({
      bestTimeSeconds: row.bestTimeSeconds ?? null,
      estimatedMinutes: row.estimatedMinutes,
    });
  }

  return startSession(db, {
    userId,
    timeZone: input.timeZone,
    now: input.now,
    problemId,
    revision: { mode, speedTargetSeconds: target },
  });
}

/**
 * What the solve page shows for a live revision sitting. Null for an ordinary
 * solve. Built per mode, so each mode loads only what it is allowed to show.
 */
export async function sittingView(
  db: Database,
  input: {
    userId: string;
    now: Date;
    session: {
      problemId: string;
      revisionMode: RevisionMode | null;
      speedTargetSeconds: number | null;
    };
  },
): Promise<RevisionSittingView | null> {
  const { session } = input;

  switch (session.revisionMode) {
    case null:
      return null;

    case 'blind':
      return { mode: 'blind' };

    case 'speed':
      return { mode: 'speed', targetSeconds: session.speedTargetSeconds ?? 0 };

    case 'mistake_first': {
      // Finished sittings only — the live one is this sitting.
      const history = await getAttemptHistory(db, {
        userId: input.userId,
        problemId: session.problemId,
        now: input.now,
      });
      const counted = history.filter((attempt) => attempt.outcome !== 'abandoned');
      const last = counted[0];
      // `none` is the taxonomy's "nothing went wrong" — not a mistake to brief on.
      const mistakes = [...new Set(counted.flatMap((attempt) => attempt.mistakes))].filter(
        (category) => category !== 'none',
      );
      return {
        mode: 'mistake_first',
        lastAttemptedAt: last ? last.endedAt.toISOString() : null,
        mistakes: mistakes.map((category) => MISTAKE_CATEGORY_LABELS[category]),
        stuckPoints: (last?.stuckMarkers ?? []).map((marker) => ({
          category: STUCK_CATEGORY_LABELS[marker.category],
          note: marker.note,
          atSeconds: marker.elapsedSeconds,
        })),
      };
    }

    case 'pattern':
      return patternSet(db, session.problemId);
  }
}

async function patternSet(
  db: Database,
  problemId: string,
): Promise<Extract<RevisionSittingView, { mode: 'pattern' }>> {
  const [tag] = await db
    .select({ value: problemTags.tagValue })
    .from(problemTags)
    .where(and(eq(problemTags.problemId, problemId), eq(problemTags.tagType, 'pattern')))
    .orderBy(asc(problemTags.tagValue))
    .limit(1);

  if (!tag) return { mode: 'pattern', pattern: null, related: [] };

  /*
   * Only problems this user could open from the catalog: published, not
   * premium (there is no entitlement to check — F4.4 is cut), and originals
   * only while `FEATURE_ORIGINAL_PROBLEMS` is on. A mini-set linking to pages
   * that 404 would be worse than no set.
   */
  const visibility = [
    eq(problems.status, 'published'),
    eq(problems.isPremium, false),
    ne(problems.id, problemId),
    ...(originalsVisible() ? [] : [eq(problems.sourceType, 'external_link')]),
  ];

  const related = await db
    .selectDistinct({ slug: problems.slug, title: problems.title })
    .from(problemTags)
    .innerJoin(problems, eq(problems.id, problemTags.problemId))
    .where(
      and(
        eq(problemTags.tagType, 'pattern'),
        eq(problemTags.tagValue, tag.value),
        ...visibility,
      ),
    )
    .orderBy(asc(problems.title))
    .limit(PATTERN_SET_SIZE);

  return { mode: 'pattern', pattern: tag.value, related };
}

/**
 * The comparison across modes, for this user.
 *
 * One query: every finished, non-abandoned sitting on any problem this user
 * has revised in a mode. The pairing and the "enough data" rule are pure.
 */
export async function modeComparison(
  db: Database,
  input: { userId: string },
): Promise<ModeComparisonView> {
  const revised = db
    .selectDistinct({ problemId: solveSessions.problemId })
    .from(solveSessions)
    .where(
      and(
        eq(solveSessions.userId, input.userId),
        inArray(solveSessions.revisionMode, ['blind', 'mistake_first', 'pattern', 'speed']),
      ),
    );

  const sittings = await db
    .select({
      problemId: solveSessions.problemId,
      startedAt: solveSessions.startedAt,
      status: solveSessions.status,
      revisionMode: solveSessions.revisionMode,
    })
    .from(solveSessions)
    .where(
      and(
        eq(solveSessions.userId, input.userId),
        inArray(solveSessions.status, ['solved', 'stuck']),
        inArray(solveSessions.problemId, revised),
      ),
    )
    .orderBy(asc(solveSessions.startedAt));

  return compareModes(
    measureRevisions(
      sittings.map((sitting) => ({
        ...sitting,
        status: sitting.status as 'solved' | 'stuck',
      })),
    ),
  );
}

/**
 * The facts the revision page shows beside every due item: when it was last
 * attempted, how that went, and which mistakes it has produced.
 */
export async function revisionContext(
  db: Database,
  input: { userId: string; problemIds: string[] },
): Promise<
  Map<
    string,
    { lastAttemptedAt: Date | null; lastOutcome: 'solved' | 'stuck' | null; mistakes: string[] }
  >
> {
  const context = new Map<
    string,
    { lastAttemptedAt: Date | null; lastOutcome: 'solved' | 'stuck' | null; mistakes: string[] }
  >();
  if (input.problemIds.length === 0) return context;

  const [latest, mistakeRows] = await Promise.all([
    db
      .selectDistinctOn([solveSessions.problemId], {
        problemId: solveSessions.problemId,
        status: solveSessions.status,
        endedAt: solveSessions.endedAt,
      })
      .from(solveSessions)
      .where(
        and(
          eq(solveSessions.userId, input.userId),
          inArray(solveSessions.problemId, input.problemIds),
          inArray(solveSessions.status, ['solved', 'stuck']),
        ),
      )
      .orderBy(solveSessions.problemId, desc(solveSessions.startedAt)),

    // The same join `dueToday` uses for the risk score, so the two agree.
    db
      .select({ problemId: solveSessions.problemId, category: reflectionMistakes.category })
      .from(reflectionMistakes)
      .innerJoin(reflections, eq(reflections.id, reflectionMistakes.reflectionId))
      .innerJoin(solveSessions, eq(solveSessions.id, reflections.sessionId))
      .where(
        and(
          eq(solveSessions.userId, input.userId),
          inArray(solveSessions.problemId, input.problemIds),
        ),
      ),
  ]);

  for (const problemId of input.problemIds) {
    const row = latest.find((candidate) => candidate.problemId === problemId);
    const categories = mistakeRows
      .filter((mistake) => mistake.problemId === problemId && mistake.category !== 'none')
      .map((mistake) => mistake.category);
    context.set(problemId, {
      lastAttemptedAt: row?.endedAt ?? null,
      lastOutcome: row ? (row.status as 'solved' | 'stuck') : null,
      mistakes: [...new Set(categories)].map((category) => MISTAKE_CATEGORY_LABELS[category]),
    });
  }
  return context;
}
