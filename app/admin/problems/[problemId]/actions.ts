'use server';

import { revalidatePath } from 'next/cache';
import { getDb } from '@/server/db';
import { getServerEnv } from '@/server/env';
import {
  publishNativeProblem,
  sendNativeProblemToReview,
  updateNativeLanguageTemplate,
  updateNativeEditorial,
  updateNativeExample,
  updateNativeProblemCore,
  updateNativeTestCase,
  validateNativeProblemReferences,
} from '@/server/services/admin';
import { requireCurrentUser } from '@/server/services/auth/session';
import { resolveProvider } from '@/server/services/execution/provider';

export async function updateNativeProblemCoreAction(formData: FormData): Promise<void> {
  const admin = await requireCurrentUser('admin');
  await updateNativeProblemCore(getDb(), admin.id, Object.fromEntries(formData));
  refresh(String(formData.get('problemId')));
}

export async function updateNativeLanguageTemplateAction(formData: FormData): Promise<void> {
  const admin = await requireCurrentUser('admin');
  await updateNativeLanguageTemplate(getDb(), admin.id, Object.fromEntries(formData));
  refresh(String(formData.get('problemId')));
}

export async function updateNativeTestCaseAction(formData: FormData): Promise<void> {
  const admin = await requireCurrentUser('admin');
  await updateNativeTestCase(getDb(), admin.id, {
    ...Object.fromEntries(formData),
    isPerformance: formData.get('isPerformance') === 'on',
  });
  refresh(String(formData.get('problemId')));
}

export async function updateNativeExampleAction(formData: FormData): Promise<void> {
  const admin = await requireCurrentUser('admin');
  await updateNativeExample(getDb(), admin.id, Object.fromEntries(formData));
  refresh(String(formData.get('problemId')));
}

export async function updateNativeEditorialAction(formData: FormData): Promise<void> {
  const admin = await requireCurrentUser('admin');
  await updateNativeEditorial(getDb(), admin.id, Object.fromEntries(formData));
  refresh(String(formData.get('problemId')));
}

export async function sendNativeProblemToReviewAction(formData: FormData): Promise<void> {
  const admin = await requireCurrentUser('admin');
  const problemId = String(formData.get('problemId'));
  await sendNativeProblemToReview(getDb(), admin.id, problemId);
  refresh(problemId);
}

export async function validateNativeProblemReferencesAction(formData: FormData): Promise<void> {
  const admin = await requireCurrentUser('admin');
  const problemId = String(formData.get('problemId'));
  await validateNativeProblemReferences(
    getDb(),
    admin.id,
    problemId,
    resolveProvider(getServerEnv()),
  );
  refresh(problemId);
}

export async function publishNativeProblemAction(formData: FormData): Promise<void> {
  const admin = await requireCurrentUser('admin');
  const problemId = String(formData.get('problemId'));
  await publishNativeProblem(getDb(), admin.id, {
    problemId,
    originalityConfirmed: formData.get('originalityConfirmed') === 'on',
    samplesConfirmed: formData.get('samplesConfirmed') === 'on',
    constraintsConfirmed: formData.get('constraintsConfirmed') === 'on',
    evidenceConfirmed: formData.get('evidenceConfirmed') === 'on',
  });
  refresh(problemId);
}

function refresh(problemId: string) {
  revalidatePath(`/admin/problems/${problemId}`);
  revalidatePath('/admin/problems');
  revalidatePath('/problems');
}
