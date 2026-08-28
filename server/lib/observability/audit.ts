/**
 * Recording what an admin did.
 *
 * Append-only at the database (migration 0019), so this module has no update
 * and no delete — there is nothing to write here that the table would accept.
 *
 * The diff goes through the SAME redactor as the logs. An admin correcting a
 * user's email address must not thereby write that address into a table nobody
 * can ever edit.
 */
import { desc, eq } from 'drizzle-orm';
import type { Database, Transaction } from '@/server/db';
import { auditLogs } from '@/server/db/schema';
import { redact } from './redact';
import { log } from './logger';

export type AuditEntry = {
  actorId: string;
  /** Dotted, like a log event: `problem.published`. */
  action: string;
  target: string;
  before?: unknown;
  after?: unknown;
  ip?: string | null;
};

/**
 * Write one entry.
 *
 * Takes a transaction when the caller has one, so the record of an action and
 * the action itself land together — an audit entry for something that rolled
 * back is a claim about an event that did not happen.
 */
export async function recordAudit(
  writer: Database | Transaction,
  entry: AuditEntry,
): Promise<void> {
  await writer.insert(auditLogs).values({
    actorId: entry.actorId,
    action: entry.action,
    target: entry.target,
    diff: {
      before: redact(entry.before ?? null),
      after: redact(entry.after ?? null),
    } as Record<string, unknown>,
    ip: entry.ip ?? null,
  });

  log.info('audit.recorded', { action: entry.action, target: entry.target });
}

/** The most recent entries, for `/admin/health`. */
export async function recentAudit(db: Database, limit = 50) {
  return db.select().from(auditLogs).orderBy(desc(auditLogs.createdAt)).limit(limit);
}

/** Everything one admin did. */
export async function auditForActor(db: Database, actorId: string, limit = 100) {
  return db
    .select()
    .from(auditLogs)
    .where(eq(auditLogs.actorId, actorId))
    .orderBy(desc(auditLogs.createdAt))
    .limit(limit);
}
