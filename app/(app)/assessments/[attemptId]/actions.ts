'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { getDb } from '@/server/db';
import { getServerEnv } from '@/server/env';
import { requireCurrentUser } from '@/server/services/auth/session';
import {
  assessmentAnswerSchema,
  finalizeAssessment,
  runAssessmentAnswer,
  switchAssessmentQuestion,
} from '@/server/services/assessments';
import {
  createRequestExecutionRunner,
  resolveExecutionBackend,
} from '@/server/services/execution';
import { assertFeatureEnabled } from '@/lib/flags';

export type AssessmentActionResult =
  { ok: true; jobId?: string } | { ok: false; message: string };

const switchSchema = z.object({
  attemptId: z.string().uuid(),
  paperQuestionId: z.string().uuid(),
});

export async function switchAssessmentQuestionAction(
  rawInput: unknown,
): Promise<AssessmentActionResult> {
  const user = await requireCurrentUser();
  try {
    const input = switchSchema.parse(rawInput);
    await switchAssessmentQuestion(getDb(), { ...input, userId: user.id, now: new Date() });
    revalidatePath(`/assessments/${input.attemptId}`);
    return { ok: true };
  } catch (error) {
    return { ok: false, message: safeMessage(error) };
  }
}

export async function runAssessmentAnswerAction(
  rawInput: unknown,
): Promise<AssessmentActionResult> {
  const user = await requireCurrentUser();
  try {
    assertFeatureEnabled('FEATURE_EXECUTION');
    const input = assessmentAnswerSchema.extend({ submit: z.boolean() }).parse(rawInput);
    const env = getServerEnv();
    const db = getDb();
    const result = await runAssessmentAnswer(db, {
      ...input,
      userId: user.id,
      now: new Date(),
      backend: resolveExecutionBackend(env),
      runner: createRequestExecutionRunner(db, env),
    });
    return result.ok
      ? { ok: true, jobId: result.jobId }
      : { ok: false, message: result.limit.message };
  } catch (error) {
    return { ok: false, message: safeMessage(error) };
  }
}

export async function finalizeAssessmentAction(
  rawInput: unknown,
): Promise<AssessmentActionResult> {
  const user = await requireCurrentUser();
  try {
    const attemptId = z.string().uuid().parse(rawInput);
    await finalizeAssessment(getDb(), { userId: user.id, attemptId, now: new Date() });
    revalidatePath(`/assessments/${attemptId}`);
    return { ok: true };
  } catch (error) {
    return { ok: false, message: safeMessage(error) };
  }
}

function safeMessage(error: unknown): string {
  if (error instanceof Error && error.name === 'FeatureDisabledError')
    return 'Code execution is currently unavailable.';
  if (error instanceof Error && error.name === 'ProviderUnavailableError')
    return 'Code execution is not configured.';
  if (error instanceof Error && error.name === 'ZodError')
    return 'That assessment request is invalid.';
  if (error instanceof Error && /assessment|question|expired/i.test(error.message))
    return error.message;
  return 'The assessment action could not be completed.';
}
