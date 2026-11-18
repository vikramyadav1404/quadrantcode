'use server';

/**
 * Codeforces sync from /settings/import. Failures are recorded on the link row
 * by the service and shown on the page, so these actions never throw to the
 * user.
 */
import { revalidatePath } from 'next/cache';
import { getDb } from '@/server/db';
import { requireCurrentUser } from '@/server/services/auth/session';
import {
  CodeforcesSyncError,
  disconnectCodeforces,
  saveCodeforcesHandle,
  syncCodeforces,
} from '@/server/services/ingest';

export async function connectCodeforcesAction(formData: FormData): Promise<void> {
  const user = await requireCurrentUser();
  const db = getDb();
  try {
    await saveCodeforcesHandle(db, user.id, String(formData.get('handle') ?? ''));
    await syncCodeforces(db, { userId: user.id, now: new Date() });
  } catch (error) {
    if (!(error instanceof CodeforcesSyncError)) throw error;
  }
  revalidatePath('/settings/import');
  revalidatePath('/problems');
}

export async function syncCodeforcesAction(): Promise<void> {
  const user = await requireCurrentUser();
  try {
    await syncCodeforces(getDb(), { userId: user.id, now: new Date() });
  } catch (error) {
    if (!(error instanceof CodeforcesSyncError)) throw error;
  }
  revalidatePath('/settings/import');
  revalidatePath('/problems');
}

export async function disconnectCodeforcesAction(): Promise<void> {
  const user = await requireCurrentUser();
  await disconnectCodeforces(getDb(), user.id);
  revalidatePath('/settings/import');
}
