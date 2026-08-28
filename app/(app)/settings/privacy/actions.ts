'use server';

/**
 * The privacy page's server actions.
 *
 * Thin adapters in the project's usual shape: authenticate, validate, call the
 * service. Both of these change or destroy the user's own data, so neither
 * takes anything from the client beyond the intent itself.
 */
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { getDb } from '@/server/db';
import { requireCurrentUser } from '@/server/services/auth/session';
import { setSnapshotCapture } from '@/server/services/profile';
import { deleteSolveHistory } from '@/server/services/timeline';

const captureSchema = z.object({ enabled: z.boolean() });

export type PrivacyActionResult =
  { ok: true; message: string } | { ok: false; message: string };

export async function setCaptureAction(input: unknown): Promise<PrivacyActionResult> {
  const user = await requireCurrentUser();

  const parsed = captureSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: 'That setting was not valid.' };

  await setSnapshotCapture(getDb(), user.id, parsed.data.enabled);
  revalidatePath('/settings/privacy');

  return {
    ok: true,
    message: parsed.data.enabled
      ? 'Code capture is on. New sessions will save your code.'
      : 'Code capture is off. Nothing new will be saved; existing code is untouched.',
  };
}

/**
 * Erase the telemetry, and report exactly what went.
 *
 * The counts are returned rather than a bare "done" because this is
 * irreversible, and "1 snapshot and 3 events deleted" is checkable in a way
 * that "your history was deleted" is not.
 *
 * **No `revalidatePath` here.** It would re-render the page without the
 * confirmation the click produced — the same mistake F2.1 made and recorded
 * (D23). Nothing on this page displays the counts, so there is nothing stale
 * to refresh.
 */
export async function deleteHistoryAction(): Promise<PrivacyActionResult> {
  const user = await requireCurrentUser();

  const { snapshots, events } = await deleteSolveHistory(getDb(), { userId: user.id });

  return {
    ok: true,
    message: `Deleted ${snapshots} saved ${snapshots === 1 ? 'version' : 'versions'} of your code and ${events} timeline ${events === 1 ? 'entry' : 'entries'}. Your sessions and streak are unchanged.`,
  };
}
