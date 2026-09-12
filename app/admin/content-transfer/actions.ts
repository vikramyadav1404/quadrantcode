'use server';

import { revalidatePath } from 'next/cache';
import { getDb } from '@/server/db';
import {
  importAdminEvidenceCsv,
  importAdminNativeJson,
  importAdminPaperJson,
} from '@/server/services/admin';
import { requireCurrentUser } from '@/server/services/auth/session';

export async function importNativeJsonAction(formData: FormData) {
  const admin = await requireCurrentUser('admin');
  await importAdminNativeJson(getDb(), admin.id, String(formData.get('source') ?? ''));
  refresh();
}
export async function importPaperJsonAction(formData: FormData) {
  const admin = await requireCurrentUser('admin');
  await importAdminPaperJson(getDb(), admin.id, String(formData.get('source') ?? ''));
  refresh();
}
export async function importEvidenceCsvAction(formData: FormData) {
  const admin = await requireCurrentUser('admin');
  await importAdminEvidenceCsv(getDb(), admin.id, String(formData.get('source') ?? ''));
  refresh();
}
function refresh() {
  revalidatePath('/admin/content-transfer');
  revalidatePath('/admin/problems');
  revalidatePath('/admin/papers');
  revalidatePath('/companies');
}
