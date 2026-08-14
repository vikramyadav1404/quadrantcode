'use server';

/**
 * Profile save. Thin adapter: session check, then the service.
 *
 * `avatarUrl` is not in `updateProfileSchema`, so a payload containing one has
 * it dropped by the parse and never reaches the database — an F0.5 acceptance
 * criterion, enforced by the schema's shape rather than by a filter here that
 * someone could forget to apply.
 */
import { revalidatePath } from 'next/cache';
import { getDb } from '@/server/db';
import { requireCurrentUser } from '@/server/services/auth/session';
import { updateProfile } from '@/server/services/profile';

export type SaveResult = { ok: true } | { ok: false; message: string };

export async function saveProfileAction(payload: unknown): Promise<SaveResult> {
  const user = await requireCurrentUser();

  try {
    await updateProfile(getDb(), user.id, payload);
    revalidatePath('/settings/profile');
    return { ok: true };
  } catch (error) {
    if (error instanceof Error && error.name === 'ZodError') {
      return { ok: false, message: 'Check the highlighted fields and try again.' };
    }
    throw error;
  }
}
