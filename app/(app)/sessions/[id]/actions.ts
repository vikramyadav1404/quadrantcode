'use server';

/**
 * This session's actions, beside the page that calls them.
 *
 * F1.5's reflection save and F3.3's stuck-point answer share this file because
 * **the server-boundary rule exempts `app/**\/actions.ts` by PATH**. A
 * `stuck-actions.ts` was rejected by lint, exactly as F1.4's
 * `session-actions.ts` was — and the fix is the same one: match the
 * convention rather than widen the pattern that guards the client bundle.
 *
 * Skipping has no action of its own on purpose. It is the absence of a save —
 * the user navigates away and no row is written — so a `skipReflectionAction`
 * would exist only to record that nothing happened, and would then have to be
 * distinguished from a reflection that was never reached at all.
 */
import { revalidatePath } from 'next/cache';
import { getDb } from '@/server/db';
import { requireCurrentUser } from '@/server/services/auth/session';
import { SessionNotFoundError } from '@/server/services/session';
import { SessionNotReflectableError, saveReflection } from '@/server/services/reflection';
import { saveReflectionSchema } from '@/server/services/reflection/input';
import { z } from 'zod';
import { StuckPointNotFoundError, answerStuckPoint } from '@/server/services/inference';

export type ReflectionActionResult = { ok: true } | { ok: false; message: string };

export async function saveReflectionAction(input: unknown): Promise<ReflectionActionResult> {
  const user = await requireCurrentUser();

  const parsed = saveReflectionSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'That is not valid.' };
  }

  try {
    await saveReflection(getDb(), {
      userId: user.id,
      now: new Date(),
      sessionId: parsed.data.sessionId,
      ...(parsed.data.approach ? { approach: parsed.data.approach } : {}),
      ...(parsed.data.achievedComplexity
        ? { achievedComplexity: parsed.data.achievedComplexity }
        : {}),
      stuckAreas: parsed.data.stuckAreas,
      mistakes: parsed.data.mistakes,
      ...(parsed.data.confidence ? { confidence: parsed.data.confidence } : {}),
    });

    // The attempt history and the last-attempt panel both read this.
    revalidatePath('/', 'layout');
    return { ok: true };
  } catch (error) {
    if (error instanceof SessionNotReflectableError || error instanceof SessionNotFoundError) {
      return { ok: false, message: error.message };
    }
    throw error;
  }
}

const answerSchema = z
  .object({
    stuckPointId: z.string().uuid(),
    action: z.enum(['confirm', 'dismiss', 'adjust']),
    lineStart: z.number().int().min(1).optional(),
    lineEnd: z.number().int().min(1).optional(),
  })
  .refine(
    (value) =>
      value.action !== 'adjust' ||
      (value.lineStart !== undefined &&
        value.lineEnd !== undefined &&
        value.lineEnd >= value.lineStart),
    { message: 'Give a start and an end, with the end no earlier than the start.' },
  );

export type StuckAnswerResult = { ok: true } | { ok: false; message: string };

export async function answerStuckAction(input: unknown): Promise<StuckAnswerResult> {
  const user = await requireCurrentUser();

  const parsed = answerSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'That was not valid.' };
  }

  try {
    await answerStuckPoint(getDb(), {
      userId: user.id,
      stuckPointId: parsed.data.stuckPointId,
      answer:
        parsed.data.action === 'adjust'
          ? {
              action: 'adjust',
              lineStart: parsed.data.lineStart!,
              lineEnd: parsed.data.lineEnd!,
            }
          : { action: parsed.data.action },
      now: new Date(),
    });
  } catch (error) {
    if (error instanceof StuckPointNotFoundError) {
      return { ok: false, message: error.message };
    }
    throw error;
  }

  /*
   * The panel keeps its own state after an answer, so this refreshes the page
   * for a later visit rather than for this click. Unlike F2.1's queue there is
   * nothing here that a re-render would erase — the row stays, with its answer
   * shown.
   */
  revalidatePath(`/sessions`);

  return { ok: true };
}
