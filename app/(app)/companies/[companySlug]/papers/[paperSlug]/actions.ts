'use server';

import { redirect } from 'next/navigation';
import { getDb } from '@/server/db';
import { requireCurrentUser } from '@/server/services/auth/session';
import { assertFeatureEnabled } from '@/lib/flags';
import { startOrResumeAssessment } from '@/server/services/assessments';

export async function startAssessmentAction(formData: FormData): Promise<void> {
  /*
   * The enforcement half of F4.5's flag. The paper page hides the button when
   * the flag is off, but hiding a control is not a gate — this is the check a
   * hand-posted form hits, in the same arrangement FEATURE_EXECUTION uses.
   */
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
