/**
 * F4.6 · every admin action, permanently.
 *
 * ## Immutable, by the same mechanism F3.2 used
 *
 * A trigger refuses UPDATE and DELETE. The criterion names UPDATE; the ticket's
 * own sentence says "no updates, no deletes", and a narrow criterion is not a
 * reason to stop honouring the requirement beside it — the argument F3.2a
 * already had and recorded (D25).
 *
 * There is NO purge escape hatch here, unlike `session_events`. That table
 * needed one because a user may delete their own history; an audit log exists
 * precisely so that the people with power over other people's data cannot
 * quietly erase what they did. Account deletion does not cascade into it either:
 * `actor_id` has no foreign key for that reason.
 */
import { sql } from 'drizzle-orm';
import { check, index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: uuid().primaryKey().defaultRandom(),

    /**
     * Who did it — an id, deliberately without a foreign key.
     *
     * A `references(users.id, { onDelete: 'cascade' })` would let deleting an
     * admin account erase everything that admin ever did, which is the one
     * deletion an audit log exists to survive.
     */
    actorId: uuid().notNull(),

    /** Dotted, like a log event: `problem.published`, `user.role_changed`. */
    action: text().notNull(),

    /** What it was done to. Free text: the target is not always a table row. */
    target: text().notNull(),

    /**
     * What changed, before and after.
     *
     * JSONB and never queried into — the same rule F1.5 set for `extras`
     * (**D21**). An audit entry is read whole by a person, not filtered by a
     * report. **Passed through the same redactor as the logs**, so an admin
     * editing a user's email does not write that email here permanently.
     */
    diff: jsonb().notNull().default({}),

    /** For rate-limit forensics. Redacted like everything else if it is absent. */
    ip: text(),

    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    /** Serves: "everything this admin did, newest first". */
    index('audit_logs_actor_created_idx').on(table.actorId, table.createdAt.desc()),

    /** Serves: "everything that happened to this target". */
    index('audit_logs_target_idx').on(table.target),

    check('audit_logs_action_not_empty', sql`length(${table.action}) > 0`),
    check('audit_logs_target_not_empty', sql`length(${table.target}) > 0`),
  ],
);

export type AuditLog = typeof auditLogs.$inferSelect;
