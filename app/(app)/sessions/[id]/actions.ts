'use server';

/**
 * Reflection actions, beside the page that calls them.
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
