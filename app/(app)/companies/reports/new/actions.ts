'use server';

import { redirect } from 'next/navigation';
import { getDb } from '@/server/db';
import { requireCurrentUser } from '@/server/services/auth/session';
import { submitInterviewReport } from '@/server/services/interview-reports';

export type ReportActionState = { error: string | null };

export async function submitInterviewReportAction(
  _state: ReportActionState,
  formData: FormData,
): Promise<ReportActionState> {
  const user = await requireCurrentUser();
  try {
    await submitInterviewReport(getDb(), user.id, {
      companyId: formData.get('companyId'),
      role: formData.get('role'),
      candidateLevel: formData.get('candidateLevel'),
      interviewYear: formData.get('interviewYear'),
      location: nullable(formData.get('location')),
      round: formData.get('round'),
      concept: formData.get('concept'),
      recollection: formData.get('recollection'),
      difficulty: formData.get('difficulty'),
      topics: String(formData.get('topics') ?? '')
        .split(',')
        .map((topic) => topic.trim().toLocaleLowerCase().replace(/\s+/g, '-'))
        .filter(Boolean),
      experience: formData.get('experience'),
      publicSourceUrl: nullable(formData.get('publicSourceUrl')),
      displayAnonymously: formData.get('displayAnonymously') === 'on',
      originalAndNdaSafe: formData.get('originalAndNdaSafe') === 'on',
      displayPermission: formData.get('displayPermission') === 'on',
    });
  } catch (error) {
    if (error instanceof Error && (error.name === 'ZodError' || error.message)) {
      return { error: error.message };
    }
    throw error;
  }
  redirect('/companies?report=submitted');
}

function nullable(value: FormDataEntryValue | null): string | null {
  const text = typeof value === 'string' ? value.trim() : '';
  return text.length > 0 ? text : null;
}
