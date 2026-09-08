'use server';

import { revalidatePath } from 'next/cache';
import { getDb } from '@/server/db';
import {
  createAdminPaper,
  publishAdminPaper,
  reviewAdminPaper,
  updateAdminPaper,
} from '@/server/services/admin';
import { requireCurrentUser } from '@/server/services/auth/session';

export async function createPaperAction(formData: FormData) {
  const admin = await requireCurrentUser('admin');
  await createAdminPaper(getDb(), admin.id, Object.fromEntries(formData));
  refresh();
}
export async function updatePaperAction(formData: FormData) {
  const admin = await requireCurrentUser('admin');
  await updateAdminPaper(getDb(), admin.id, Object.fromEntries(formData));
  refresh();
}
export async function reviewPaperAction(formData: FormData) {
  const admin = await requireCurrentUser('admin');
  await reviewAdminPaper(getDb(), admin.id, String(formData.get('paperId')));
  refresh();
}
export async function publishPaperAction(formData: FormData) {
  const admin = await requireCurrentUser('admin');
  await publishAdminPaper(
    getDb(),
    admin.id,
    String(formData.get('paperId')),
    formData.get('patternLabelConfirmed') === 'on',
  );
  refresh();
}
function refresh() {
  revalidatePath('/admin/papers');
  revalidatePath('/companies');
}
