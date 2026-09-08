'use server';

import { revalidatePath } from 'next/cache';
import { getDb } from '@/server/db';
import { requireCurrentUser } from '@/server/services/auth/session';
import { moderateInterviewReport } from '@/server/services/interview-reports';

export async function moderateInterviewReportAction(formData: FormData): Promise<void> {
  const moderator = await requireCurrentUser('admin');
  await moderateInterviewReport(getDb(), moderator.id, {
    reportId: formData.get('reportId'),
    toStatus: formData.get('toStatus'),
    reason: formData.get('reason'),
    sourceReviewed: formData.get('sourceReviewed') === 'on',
    originalityReviewed: formData.get('originalityReviewed') === 'on',
    ndaSafe: formData.get('ndaSafe') === 'on',
    assignedEvidenceType: nullable(formData.get('assignedEvidenceType')),
    duplicateGroupKey: nullable(formData.get('duplicateGroupKey')),
    editedExperience: nullable(formData.get('editedExperience')),
    editedRecollection: nullable(formData.get('editedRecollection')),
  });
  revalidatePath('/admin/interview-reports');
}

function nullable(value: FormDataEntryValue | null): string | null {
  const text = typeof value === 'string' ? value.trim() : '';
  return text.length > 0 ? text : null;
}
