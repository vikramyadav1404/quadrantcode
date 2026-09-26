'use server';

/**
 * Recording how a revision went.
 *
 * A thin adapter in the project's usual shape: authenticate, validate, call the
 * service, resolve `now` here. The outcome is the only thing the client sends —
 * the interval it produces is decided by the ladder, server-side, which is the
 * same rule F1.4 applies to durations (D20).
 */
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { isFeatureEnabled } from '@/lib/flags';
import { REVISION_MODES } from '@/lib/revision/modes';
import { getDb } from '@/server/db';
import { requireCurrentUser } from '@/server/services/auth/session';
import { recordRevisionOutcome } from '@/server/services/revision';
import {
  NotScheduledForRevisionError,
  startRevisionSitting,
} from '@/server/services/revision/modes';
import { ActiveSessionExistsError } from '@/server/services/session';
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

const startSchema = z.object({
  problemId: z.string().uuid(),
  mode: z.enum(REVISION_MODES),
});

export type StartRevisionResult = { ok: true } | { ok: false; message: string };

/**
 * F2.2 · begin a sitting in a revision mode.
 *
 * The client sends a problem and a mode — intent only. Eligibility and the
 * speed target are decided by the service, and the target never comes from the
 * request (the same rule D20 applies to durations).
 */
export async function startRevisionSittingAction(input: unknown): Promise<StartRevisionResult> {
  const user = await requireCurrentUser();
  if (!isFeatureEnabled('FEATURE_REVISION_MODES')) {
    return { ok: false, message: 'Revision modes are not enabled.' };
  }

  const parsed = startSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: 'That is not a revision mode.' };

  try {
    await startRevisionSitting(getDb(), {
      userId: user.id,
      timeZone: user.timezone,
      now: new Date(),
      problemId: parsed.data.problemId,
      mode: parsed.data.mode,
    });
  } catch (error) {
    if (
      error instanceof ActiveSessionExistsError ||
      error instanceof NotScheduledForRevisionError
    ) {
      return { ok: false, message: error.message };
    }
    throw error;
  }

  // The timer bar lives in the layout; it has to learn about the new sitting.
  revalidatePath('/', 'layout');
  return { ok: true };
}
