/**
 * A problem's attempt history: the timeline, and the "your last attempt" panel.
 *
 * One function serves both, because they are the same data seen at two lengths
 * — and because two queries that were supposed to agree are how a panel starts
 * showing a different "last attempt" from the row at the top of the list.
 *
 * ## Four queries, never N+1
 *
 * Durations come from the event log, and stuck markers and mistakes from their
 * own tables, so the naive version runs three queries per session. This loads
 * the sessions, then every event, marker and mistake for that set at once, and
 * groups in memory. A problem with forty attempts costs the same four round
 * trips as one with two.
 */
import { and, asc, eq, inArray } from 'drizzle-orm';
import type { Database } from '@/server/db';
import {
  reflectionMistakes,
  reflections,
  sessionEvents,
  solveSessions,
  stuckPoints,
} from '@/server/db/schema';
import type { AttemptOutcome, AttemptView } from '@/lib/reflection/attempt-view';
import type { MistakeCategory } from '@/lib/reflection/taxonomy';
import { activeDurationSeconds } from '@/server/services/session';
import { TERMINAL_STATUSES } from '@/server/services/session';

/*
 * Re-exported from `lib/` rather than declared here: `components/` may not
 * import from `server/` (F0.1), and this shape is the contract between the
 * query below and the timeline that renders it — the same arrangement as
 * `HeatmapDay` and `TimerBarState`.
 */
export type {
  AttemptOutcome,
  AttemptView as AttemptEntry,
} from '@/lib/reflection/attempt-view';

/**
 * Every finished session on a problem, newest first.
 *
 * Live sessions are excluded: the running one is already on screen in the timer
 * bar, and a timeline entry with no end and a moving duration would be a second
 * place to look at the same thing.
 */
export async function getAttemptHistory(
  db: Database,
  input: { userId: string; problemId: string; now: Date },
): Promise<AttemptView[]> {
  const { userId, problemId, now } = input;

  const sessions = await db
    .select({
      id: solveSessions.id,
      status: solveSessions.status,
      startedAt: solveSessions.startedAt,
      endedAt: solveSessions.endedAt,
      confidence: solveSessions.confidence,
    })
    .from(solveSessions)
    .where(
      and(
        eq(solveSessions.userId, userId),
        eq(solveSessions.problemId, problemId),
        inArray(solveSessions.status, [...TERMINAL_STATUSES]),
      ),
    )
    /*
     * By `started_at`, not by `created_at` or by id. A backfilled session — one
     * inserted later for a solve that happened last week — has to land in its
     * own place in the story, and only the start instant knows where that is.
     */
    .orderBy(asc(solveSessions.startedAt));

  if (sessions.length === 0) return [];

  const sessionIds = sessions.map((session) => session.id);

  const [events, markers, reflectionRows] = await Promise.all([
    db
      .select({
        sessionId: sessionEvents.sessionId,
        type: sessionEvents.type,
        occurredAt: sessionEvents.occurredAt,
      })
      .from(sessionEvents)
      .where(inArray(sessionEvents.sessionId, sessionIds)),

    db
      .select({
        sessionId: stuckPoints.sessionId,
        category: stuckPoints.category,
        elapsedSeconds: stuckPoints.elapsedSeconds,
        note: stuckPoints.note,
      })
      .from(stuckPoints)
      .where(and(inArray(stuckPoints.sessionId, sessionIds), eq(stuckPoints.source, 'user')))
      .orderBy(asc(stuckPoints.elapsedSeconds)),

    db
      .select({
        sessionId: reflections.sessionId,
        approach: reflections.approach,
        achievedComplexity: reflections.achievedComplexity,
        mistake: reflectionMistakes.category,
      })
      .from(reflections)
      .leftJoin(reflectionMistakes, eq(reflectionMistakes.reflectionId, reflections.id))
      .where(inArray(reflections.sessionId, sessionIds)),
  ]);

  const eventsBySession = groupBy(events, (event) => event.sessionId);
  const markersBySession = groupBy(markers, (marker) => marker.sessionId);
  const reflectionsBySession = groupBy(reflectionRows, (row) => row.sessionId);

  let attemptNumber = 0;

  const entries = sessions.map((session) => {
    const outcome = session.status as AttemptOutcome;
    const counts = outcome !== 'abandoned';
    if (counts) attemptNumber += 1;

    const reflectionForSession = reflectionsBySession.get(session.id) ?? [];
    const first = reflectionForSession[0];

    return {
      sessionId: session.id,
      attemptNumber: counts ? attemptNumber : null,
      outcome,
      startedAt: session.startedAt,
      // Terminal sessions always have an end — the CHECK constraint guarantees
      // it, so this is a type narrowing rather than a fallback.
      endedAt: session.endedAt ?? session.startedAt,
      activeDurationSeconds: activeDurationSeconds(
        {
          startedAt: session.startedAt,
          endedAt: session.endedAt,
          events: eventsBySession.get(session.id) ?? [],
        },
        now,
      ),
      confidence: session.confidence,
      stuckMarkers: (markersBySession.get(session.id) ?? []).map((marker) => ({
        // Nullable since F3.3, but only for inferred rows — and this query
        // filters to `source = 'user'`, which the CHECK constraint
        // `stuck_points_user_has_category` makes a guarantee rather than a hope.
        category: marker.category!,
        elapsedSeconds: marker.elapsedSeconds,
        note: marker.note,
      })),
      mistakes: reflectionForSession
        .map((row) => row.mistake)
        .filter((mistake): mistake is MistakeCategory => mistake !== null),
      approach: first?.approach ?? null,
      achievedComplexity: first?.achievedComplexity ?? null,
      hasReflection: first !== undefined,
    } satisfies AttemptView;
  });

  // Numbered oldest-first, shown newest-first.
  return entries.reverse();
}

/**
 * The most recent finished attempt, for the panel shown when a solved problem
 * is reopened. Null when the user has never finished one.
 */
export async function getLastAttempt(
  db: Database,
  input: { userId: string; problemId: string; now: Date },
): Promise<AttemptView | null> {
  const history = await getAttemptHistory(db, input);
  return history[0] ?? null;
}

function groupBy<T, K>(rows: readonly T[], key: (row: T) => K): Map<K, T[]> {
  const grouped = new Map<K, T[]>();

  for (const row of rows) {
    const bucket = grouped.get(key(row));
    if (bucket) bucket.push(row);
    else grouped.set(key(row), [row]);
  }

  return grouped;
}
