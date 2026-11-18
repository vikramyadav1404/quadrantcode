'use server';

import { revalidatePath } from 'next/cache';
import { getDb } from '@/server/db';
import { userProfiles } from '@/server/db/schema';
import { requireCurrentUser } from '@/server/services/auth/session';

/**
 * Switch scheduler. Only the choice changes: dates already set stay as they
 * are, and the new scheduler takes over at each problem's next solve or
 * revision.
 */
export async function setSchedulerAction(formData: FormData): Promise<void> {
  const user = await requireCurrentUser();
  const scheduler = formData.get('scheduler') === 'fsrs' ? 'fsrs' : 'ladder';
  await getDb()
    .insert(userProfiles)
    .values({ userId: user.id, revisionScheduler: scheduler })
    .onConflictDoUpdate({
      target: userProfiles.userId,
      set: { revisionScheduler: scheduler, updatedAt: new Date() },
    });
  revalidatePath('/settings/revision');
}
