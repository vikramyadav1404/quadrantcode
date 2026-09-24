/**
 * F1.4 · solve sessions and their event log.
 *
 * ## The server owns every timestamp
 *
 * Nothing here is ever written from a client-supplied time. `started_at`,
 * `ended_at`, `last_heartbeat_at` and every event's `occurred_at` come from the
 * database's own clock or from a `now` the service resolved server-side. The
 * client sends intent — start, pause, resume, finish — and never a duration.
 *
 * That is why there is **no `active_duration_seconds` column**. A stored
 * duration is a number someone can be wrong about: it drifts if an event is
 * replayed, it is tempting to accept from a request, and it has to be kept in
 * step with the events that justify it. The duration is computed from the event
 * rows on read (`duration.ts`), so the events ARE the record and the number is
 * always a function of them.
 *
 * ## Two local dates, and why they can differ
 *
 * A session begun at 23:50 and solved at 00:30 spans a day boundary. Both dates
 * are resolved in the user's timezone **at the moment each is written** and are
 * never re-resolved, which is D18's rule applied to sessions.
 *
 * The streak credits `ended_local_date` — the day the solve became a fact. The
 * alternative, crediting the day the sitting began, lets a user hold a session
 * open across midnight to bank a solve for a day they did not finish.
 */
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import {
  confidenceEnum,
  revisionModeEnum,
  sessionEventTypeEnum,
  solveSessionStatusEnum,
} from './enums';
import { problems } from './problems';
import { users } from './users';

export const solveSessions = pgTable(
  'solve_sessions',
  {
    id: uuid().primaryKey().defaultRandom(),

    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    problemId: uuid()
      .notNull()
      .references(() => problems.id, { onDelete: 'cascade' }),

    status: solveSessionStatusEnum().notNull().default('active'),

    startedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),

    /** Null while the session is live; set by the terminal transition. */
    endedAt: timestamp({ withTimezone: true }),

    /**
     * The last heartbeat the client sent, or the start if it has sent none.
     *
     * Two things read it. Idle autopause treats it as the moment the user
     * stopped being present — the pause is recorded from THERE, not from when
     * the server happened to notice, or a user who closed their laptop would be
     * billed for the time until someone next loaded a page. The 6-hour sweep
     * uses the same instant for the same reason.
     */
    lastHeartbeatAt: timestamp({ withTimezone: true }).notNull().defaultNow(),

    /** Resolved in the user's timezone when the session BEGAN. */
    startedLocalDate: date().notNull(),

    /**
     * Resolved when the session ENDED — the date the streak credits.
     *
     * Null while live. It is a separate column rather than something derived
     * from `ended_at` later, because deriving it later would re-resolve a past
     * instant against whatever timezone the user has by then (D18).
     */
    endedLocalDate: date(),

    /** Self-reported, captured at completion. F1.5 adds the rest of the reflection. */
    confidence: confidenceEnum(),

    /**
     * F2.2 · the revision mode this sitting ran in, or null for an ordinary solve.
     *
     * Nullable and without a default because every session that existed before
     * F2.2 was an ordinary solve, and null says exactly that — no backfill.
     */
    revisionMode: revisionModeEnum(),

    /**
     * F2.2 speed mode only: the target, fixed when the sitting starts as
     * min(previous best, estimate). Stored rather than recomputed because the
     * previous best moves the moment this sitting beats it.
     */
    speedTargetSeconds: integer(),

    /**
     * F2.2 speed mode only: whether the sitting was solved within the target.
     * Null until a speed sitting finishes; always null for other modes.
     */
    speedTargetMet: boolean(),

    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    /**
     * ONE LIVE SESSION PER USER, enforced by the database.
     *
     * The service returns a typed conflict before it ever gets here, and this
     * index is the backstop for the case the service cannot see: two requests
     * racing. Partial, because terminal sessions must be unlimited — a user has
     * as many finished sessions as they have solves.
     *
     * Same defence-in-depth argument as the C1 CHECK constraint: the service
     * gives the good error, the index makes the rule true.
     */
    uniqueIndex('solve_sessions_one_live_per_user')
      .on(table.userId)
      .where(sql`${table.status} in ('active', 'paused')`),

    /**
     * Serves: "this user's sessions for a problem, newest first" — the attempt
     * history F1.5 renders and the rehydration lookup —
     *   SELECT ... FROM solve_sessions
     *   WHERE user_id = $1 AND problem_id = $2
     *   ORDER BY started_at DESC
     */
    index('solve_sessions_user_problem_idx').on(
      table.userId,
      table.problemId,
      table.startedAt.desc(),
    ),

    /**
     * Serves the 6-hour sweep, which scans live sessions by heartbeat age —
     *   SELECT id FROM solve_sessions
     *   WHERE status in ('active','paused') AND last_heartbeat_at < $1
     * Partial, so it stays the size of the live set rather than of all history.
     */
    index('solve_sessions_live_heartbeat_idx')
      .on(table.lastHeartbeatAt)
      .where(sql`${table.status} in ('active', 'paused')`),

    /**
     * Serves F1.6's per-day rollup, which reads finished sessions by local date.
     */
    index('solve_sessions_user_ended_idx').on(table.userId, table.endedLocalDate.desc()),

    /**
     * A live session has no end, and a finished one has both an end and the
     * local date that end resolved to. Written as one constraint because the
     * three fields are one fact; letting them disagree would let a session be
     * "solved" while still counting time.
     */
    check(
      'solve_sessions_terminal_has_end',
      sql`
      (${table.status} in ('active', 'paused')
        and ${table.endedAt} is null and ${table.endedLocalDate} is null)
      or
      (${table.status} in ('solved', 'stuck', 'abandoned')
        and ${table.endedAt} is not null and ${table.endedLocalDate} is not null)
    `,
    ),

    check(
      'solve_sessions_ends_after_start',
      sql`
      (${table.endedAt} is null or ${table.endedAt} >= ${table.startedAt})
    `,
    ),

    check(
      'solve_sessions_heartbeat_after_start',
      sql`
      ${table.lastHeartbeatAt} >= ${table.startedAt}
    `,
    ),

    /**
     * F2.2 · a speed sitting has a positive target and nothing else does; a
     * hit/miss exists only on a finished speed sitting. One constraint because
     * the three columns are one fact, as with `solve_sessions_terminal_has_end`.
     * Every pre-F2.2 row has all three null and satisfies it.
     */
    check(
      'solve_sessions_speed_fields_consistent',
      sql`
      (${table.revisionMode} = 'speed'
        and ${table.speedTargetSeconds} is not null and ${table.speedTargetSeconds} > 0
        and (${table.speedTargetMet} is null or ${table.status} in ('solved', 'stuck', 'abandoned')))
      or
      (${table.revisionMode} is distinct from 'speed'
        and ${table.speedTargetSeconds} is null and ${table.speedTargetMet} is null)
    `,
    ),
  ],
);

/**
 * What happened during a session, in order.
 *
 * **Append-only in intent today, append-only by enforcement in F3.2.** That
 * ticket adds the trigger or restricted role that makes an UPDATE impossible;
 * until then nothing in the codebase updates or deletes a row here, and the
 * duration arithmetic depends on that being true.
 *
 * The pause intervals live here as `paused` → `resumed` pairs rather than as a
 * counter on the session, which the ticket requires and which is also the only
 * version that survives a replay: a counter incremented twice is silently
 * wrong, whereas a duplicated event is visible.
 */
export const sessionEvents = pgTable(
  'session_events',
  {
    id: uuid().primaryKey().defaultRandom(),

    sessionId: uuid()
      .notNull()
      .references(() => solveSessions.id, { onDelete: 'cascade' }),

    type: sessionEventTypeEnum().notNull(),

    /**
     * When the event HAPPENED, which is not always when it was written.
     *
     * An idle autopause is stamped with the last heartbeat — the moment the
     * user stopped being present — and is written minutes later when something
     * notices. Recording the write time instead would hand the user free active
     * minutes for a session they had walked away from.
     */
    occurredAt: timestamp({ withTimezone: true }).notNull().defaultNow(),

    /**
     * Event-specific detail. Deliberately small and deliberately NOT where any
     * taxonomy lives — F1.5's storage rule ("queryable with a WHERE clause on
     * an enum column, no JSON extraction") applies here too. `type` is an enum
     * for exactly that reason.
     */
    payload: jsonb().notNull().default({}),

    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    /**
     * Serves: "every event for a session, in order" — the duration computation
     * and the F3.2 timeline —
     *   SELECT ... FROM session_events
     *   WHERE session_id = $1 ORDER BY occurred_at
     */
    index('session_events_session_occurred_idx').on(table.sessionId, table.occurredAt),
  ],
);

export type SolveSession = typeof solveSessions.$inferSelect;
export type SessionEvent = typeof sessionEvents.$inferSelect;
