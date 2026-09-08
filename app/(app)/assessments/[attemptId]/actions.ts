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
import { InProcessExecutionRunner, resolveProvider } from '@/server/services/execution';

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
    const input = assessmentAnswerSchema.extend({ submit: z.boolean() }).parse(rawInput);
    const result = await runAssessmentAnswer(getDb(), {
      ...input,
      userId: user.id,
      now: new Date(),
      runner: new InProcessExecutionRunner(getDb(), resolveProvider(getServerEnv())),
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
  if (error instanceof Error && error.name === 'ZodError')
    return 'That assessment request is invalid.';
  if (error instanceof Error && /assessment|question|expired/i.test(error.message))
    return error.message;
  return 'The assessment action could not be completed.';
}
