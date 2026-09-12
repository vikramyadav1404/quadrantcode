'use server';

import { revalidatePath } from 'next/cache';
import { getDb } from '@/server/db';
import { createAdminEvidence, updateAdminCompany } from '@/server/services/admin';
import { requireCurrentUser } from '@/server/services/auth/session';

export async function updateCompanyAction(formData: FormData): Promise<void> {
  const admin = await requireCurrentUser('admin');
  await updateAdminCompany(getDb(), admin.id, {
    ...Object.fromEntries(formData),
    isActive: formData.get('isActive') === 'on',
  });
  revalidatePath('/admin/companies');
  revalidatePath('/companies');
}

export async function createEvidenceAction(formData: FormData): Promise<void> {
  const admin = await requireCurrentUser('admin');
  await createAdminEvidence(getDb(), admin.id, {
    ...Object.fromEntries(formData),
    role: nullable(formData.get('role')),
    round: nullable(formData.get('round')),
    candidateLevel: nullable(formData.get('candidateLevel')),
    location: nullable(formData.get('location')),
    sourceUrl: nullable(formData.get('sourceUrl')),
    lastReviewedDate: nullable(formData.get('lastReviewedDate')),
  });
  revalidatePath('/admin/companies');
  revalidatePath('/companies');
}

function nullable(value: FormDataEntryValue | null): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}
