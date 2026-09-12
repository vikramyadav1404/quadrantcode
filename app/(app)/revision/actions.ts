'use server';

/**
 * Recording how a revision went.
 *
 * A thin adapter in the project's usual shape: authenticate, validate, call the
 * service, resolve `now` here. The outcome is the only thing the client sends —
 * the interval it produces is decided by the ladder, server-side, which is the
 * same rule F1.4 applies to durations (D20).
 */
import { z } from 'zod';
import { getDb } from '@/server/db';
import { requireCurrentUser } from '@/server/services/auth/session';
import { recordRevisionOutcome } from '@/server/services/revision';
import { localDateFor } from '@/server/services/streak';

const schema = z.object({
  problemId: z.string().uuid(),
  outcome: z.enum(['clean', 'struggled', 'failed']),
});

export type RecordOutcomeResult =
  { ok: true; nextInDays: number } | { ok: false; message: string };

export async function recordRevisionAction(input: unknown): Promise<RecordOutcomeResult> {
  const user = await requireCurrentUser();

  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, message: 'That is not an outcome we record.' };

  const next = await recordRevisionOutcome(getDb(), {
    userId: user.id,
    problemId: parsed.data.problemId,
    outcome: parsed.data.outcome,
    today: localDateFor(new Date(), user.timezone),
  });

  /*
   * Null means the problem has no schedule — never solved, or someone else's.
   * Both are the same answer to the caller for the same reason F1.4 gives one
   * not-found for both: confirming which would tell them something they have no
   * claim to.
   */
  if (!next) return { ok: false, message: 'That problem is not scheduled for revision.' };

  /*
   * Deliberately no `revalidatePath('/revision')`.
   *
   * Recording an outcome pushes the problem out of today's queue, so a
   * revalidation re-renders the page WITHOUT that row — erasing the very
   * confirmation the click just produced. The user sees their answer flash and
   * vanish, and never learns when the problem comes back.
   *
   * Found by an e2e test that clicked "Got it" and then could not find the
   * message; it passed in isolation and failed in a full run, which is what a
   * race looks like from the outside. The list keeps the answered row until the
   * page is loaded again, which is when the queue should change.
   */
  return { ok: true, nextInDays: next.intervalDays };
}
