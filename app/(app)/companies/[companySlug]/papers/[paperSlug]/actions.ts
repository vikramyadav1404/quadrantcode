'use server';

import { redirect } from 'next/navigation';
import { getDb } from '@/server/db';
import { requireCurrentUser } from '@/server/services/auth/session';
import { startOrResumeAssessment } from '@/server/services/assessments';

export async function startAssessmentAction(formData: FormData): Promise<void> {
  const user = await requireCurrentUser();
  const paperId = String(formData.get('paperId') ?? '');
  const result = await startOrResumeAssessment(getDb(), {
    userId: user.id,
    paperId,
    now: new Date(),
  });
  redirect(`/assessments/${result.attemptId}`);
}
