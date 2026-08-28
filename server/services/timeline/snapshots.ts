/**
 * Capturing code snapshots, and rebuilding source from them.
 *
 * ## What is stored
 *
 * Sequence 0 holds the full source. Everything after it holds a diff against
 * the version before, so a session of forty edits costs one source plus thirty-
 * nine sets of changed lines rather than forty sources.
 *
 * ## When a snapshot is taken
 *
 * Always on a run attempt or a stuck marker — those are the moments F3.3 will
 * want to look at, and missing one loses the evidence for a signal. Otherwise
 * at most once a minute, **and only when the code actually changed**: a user
 * reading the problem for ten minutes should cost ten rows of nothing, not ten
 * copies of the same file.
 *
 * "Actually changed" is compared against the reconstructed previous source, not
 * against a hash the caller supplies. The client is not asked whether its code
 * is new for the same reason it is not asked how long the timer has run.
 */
import { and, asc, desc, eq, lte } from 'drizzle-orm';
import type { Database, Transaction } from '@/server/db';
import { codeSnapshots, MAX_SNAPSHOT_BYTES } from '@/server/db/schema';
import type { ExecutionLanguage } from '@/lib/execution/languages';
import { SNAPSHOT_INTERVAL_MS, type SnapshotTrigger } from '@/lib/timeline/events';
import { applyDiff, decodeDiff, diffLines, encodeDiff } from './diff';

export class SnapshotTooLargeError extends Error {
  readonly status = 413;

  constructor(bytes: number) {
    super(`That source is ${bytes} bytes; the limit is ${MAX_SNAPSHOT_BYTES}.`);
    this.name = 'SnapshotTooLargeError';
  }
}

export class SnapshotChainError extends Error {
  readonly status = 500;

  constructor(message: string) {
    super(message);
    this.name = 'SnapshotChainError';
  }
}

export type CaptureResult =
  | { captured: true; sequence: number; isFull: boolean }
  /** Nothing was written, and why — the caller may want to say so. */
  | { captured: false; reason: 'unchanged' | 'too_soon' | 'disabled' };

/** A trigger that must always produce a row, whatever the interval says. */
const FORCED_TRIGGERS = new Set<SnapshotTrigger>(['run_attempt', 'stuck_marker']);

/**
 * Take a snapshot of the current source, if the rules say to.
 *
 * Runs inside the caller's transaction when there is one, so a run attempt and
 * its snapshot land together or not at all — a snapshot referring to a run that
 * was rolled back is a row about something that did not happen.
 */
export async function captureSnapshot(
  writer: Database | Transaction,
  input: {
    sessionId: string;
    userId: string;
    language: ExecutionLanguage;
    source: string;
    trigger: SnapshotTrigger;
    occurredAt: Date;
    /** From the user's settings. False means capture is off entirely (F3.2b). */
    enabled: boolean;
  },
): Promise<CaptureResult> {
  if (!input.enabled) return { captured: false, reason: 'disabled' };

  const bytes = Buffer.byteLength(input.source, 'utf8');
  if (bytes > MAX_SNAPSHOT_BYTES) throw new SnapshotTooLargeError(bytes);

  const [latest] = await writer
    .select({
      sequence: codeSnapshots.sequence,
      occurredAt: codeSnapshots.occurredAt,
    })
    .from(codeSnapshots)
    .where(eq(codeSnapshots.sessionId, input.sessionId))
    .orderBy(desc(codeSnapshots.sequence))
    .limit(1);

  // The first snapshot of a session is always taken, and always full.
  if (!latest) {
    await writer.insert(codeSnapshots).values({
      sessionId: input.sessionId,
      userId: input.userId,
      sequence: 0,
      language: input.language,
      isFull: true,
      content: input.source,
      sourceBytes: bytes,
      trigger: input.trigger,
      occurredAt: input.occurredAt,
    });

    return { captured: true, sequence: 0, isFull: true };
  }

  const forced = FORCED_TRIGGERS.has(input.trigger);

  if (!forced) {
    const sinceLast = input.occurredAt.getTime() - latest.occurredAt.getTime();
    if (sinceLast < SNAPSHOT_INTERVAL_MS) return { captured: false, reason: 'too_soon' };
  }

  const previous = await reconstructAt(writer, input.sessionId, latest.sequence);

  /*
   * Unchanged wins even over a forced trigger. Two runs of the same code are
   * two RUN events, and the second snapshot would be a byte-for-byte copy whose
   * only content is "still the same" — which the run events already say.
   */
  if (previous === input.source) return { captured: false, reason: 'unchanged' };

  const ops = diffLines(previous, input.source);
  const encoded = encodeDiff(ops);

  /*
   * A diff bigger than the file it describes is a rewrite. Storing the source
   * instead keeps the chain shorter, which makes every later reconstruction
   * cheaper — and the constraint permits a later full snapshot for exactly this.
   */
  const storeFull = encoded.length >= input.source.length;

  await writer.insert(codeSnapshots).values({
    sessionId: input.sessionId,
    userId: input.userId,
    sequence: latest.sequence + 1,
    language: input.language,
    isFull: storeFull,
    content: storeFull ? input.source : encoded,
    sourceBytes: bytes,
    trigger: input.trigger,
    occurredAt: input.occurredAt,
  });

  return { captured: true, sequence: latest.sequence + 1, isFull: storeFull };
}

/**
 * Rebuild the source as it stood at a given sequence.
 *
 * Walks back to the nearest full snapshot rather than always to sequence 0, so
 * a re-based chain costs only what it must.
 */
async function reconstructAt(
  reader: Database | Transaction,
  sessionId: string,
  sequence: number,
): Promise<string> {
  const [base] = await reader
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

  const chain = await reader
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
