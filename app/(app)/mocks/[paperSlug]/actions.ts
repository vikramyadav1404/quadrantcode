'use server';

import { redirect } from 'next/navigation';
import { getDb } from '@/server/db';
import { requireCurrentUser } from '@/server/services/auth/session';
import { assertFeatureEnabled } from '@/lib/flags';
import { startOrResumeAssessment } from '@/server/services/assessments';

/** F4.5's flag enforced here too: hiding the button is not a gate. */
export async function startMockAction(formData: FormData): Promise<void> {
  assertFeatureEnabled('FEATURE_MOCKS');
  const user = await requireCurrentUser();
  const paperId = String(formData.get('paperId') ?? '');
  const result = await startOrResumeAssessment(getDb(), {
    userId: user.id,
    paperId,
    now: new Date(),
  });
  redirect(`/assessments/${result.attemptId}`);
}
