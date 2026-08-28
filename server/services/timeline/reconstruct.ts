/**
 * Rebuilding the source a user had at any point in a session.
 *
 * The public entry point. Scoped to the owner, so another user's snapshot is
 * indistinguishable from one that does not exist — the same rule the session
 * and execution reads follow, and the one F4.8 will enumerate.
 */
import { and, asc, desc, eq, lte } from 'drizzle-orm';
import type { Database } from '@/server/db';
import { codeSnapshots, solveSessions } from '@/server/db/schema';
import type { ExecutionLanguage } from '@/lib/execution/languages';
import { applyDiff, decodeDiff } from './diff';
import { SnapshotChainError } from './snapshots';

export type ReconstructedSource = {
  snapshotId: string;
  sequence: number;
  /** The column is `execution_language`, so this is the union and not a string. */
  language: ExecutionLanguage;
  occurredAt: Date;
  source: string;
};

/**
 * The source as it stood at one snapshot.
 *
 * `null` when the snapshot does not exist or is not this user's. A throw would
 * distinguish those two cases, which is precisely what an IDOR probe wants.
 */
export async function reconstruct(
  db: Database,
  input: { userId: string; snapshotId: string },
): Promise<ReconstructedSource | null> {
  const [target] = await db
    .select({
      id: codeSnapshots.id,
      sessionId: codeSnapshots.sessionId,
      sequence: codeSnapshots.sequence,
      language: codeSnapshots.language,
      occurredAt: codeSnapshots.occurredAt,
    })
    .from(codeSnapshots)
    .where(and(eq(codeSnapshots.id, input.snapshotId), eq(codeSnapshots.userId, input.userId)))
    .limit(1);

  if (!target) return null;

  return {
    snapshotId: target.id,
    sequence: target.sequence,
    language: target.language,
    occurredAt: target.occurredAt,
    source: await replay(db, target.sessionId, target.sequence),
  };
}

/**
 * Every snapshot of a session, rebuilt.
 *
 * One pass rather than N calls to `reconstruct`: the chain is walked once and
 * each version falls out of it, which is what the timeline's expandable diffs
 * need and what a per-snapshot loop would turn into O(n²) work.
 */
export async function reconstructSession(
  db: Database,
  input: { userId: string; sessionId: string },
): Promise<ReconstructedSource[]> {
  const [session] = await db
    .select({ id: solveSessions.id })
    .from(solveSessions)
    .where(and(eq(solveSessions.id, input.sessionId), eq(solveSessions.userId, input.userId)))
    .limit(1);

  if (!session) return [];

  const rows = await db
    .select({
      id: codeSnapshots.id,
      sequence: codeSnapshots.sequence,
      language: codeSnapshots.language,
      occurredAt: codeSnapshots.occurredAt,
      isFull: codeSnapshots.isFull,
      content: codeSnapshots.content,
    })
    .from(codeSnapshots)
    .where(eq(codeSnapshots.sessionId, input.sessionId))
    .orderBy(asc(codeSnapshots.sequence));

  const out: ReconstructedSource[] = [];
  let current = '';

  for (const row of rows) {
    current = row.isFull ? row.content : applyDiff(current, decodeDiff(row.content));

    out.push({
      snapshotId: row.id,
      sequence: row.sequence,
      language: row.language,
      occurredAt: row.occurredAt,
      source: current,
    });
  }

  return out;
}

/** Walk from the nearest full snapshot up to `sequence`. */
async function replay(db: Database, sessionId: string, sequence: number): Promise<string> {
  const [base] = await db
    .select({ sequence: codeSnapshots.sequence, content: codeSnapshots.content })
    .from(codeSnapshots)
    .where(
      and(
        eq(codeSnapshots.sessionId, sessionId),
        eq(codeSnapshots.isFull, true),
        lte(codeSnapshots.sequence, sequence),
      ),
    )
    .orderBy(desc(codeSnapshots.sequence))
    .limit(1);

  if (!base) {
    throw new SnapshotChainError(
      `session ${sessionId} has no full snapshot at or before sequence ${sequence}`,
    );
  }

  if (base.sequence === sequence) return base.content;

  const chain = await db
    .select({ sequence: codeSnapshots.sequence, content: codeSnapshots.content })
    .from(codeSnapshots)
    .where(eq(codeSnapshots.sessionId, sessionId))
    .orderBy(asc(codeSnapshots.sequence));

  let source = base.content;

  for (const row of chain) {
    if (row.sequence <= base.sequence) continue;
    if (row.sequence > sequence) break;

    source = applyDiff(source, decodeDiff(row.content));
  }

  return source;
}
