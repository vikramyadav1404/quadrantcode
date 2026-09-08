import { z } from 'zod';
import { EXECUTION_LANGUAGES } from '@/lib/execution/languages';
import { MAX_SOURCE_BYTES } from '@/server/db/schema/execution';

export const assessmentIdSchema = z.string().uuid();

export const assessmentAnswerSchema = z.object({
  attemptId: z.string().uuid(),
  paperQuestionId: z.string().uuid(),
  language: z.enum(EXECUTION_LANGUAGES),
  source: z.string().min(1).max(MAX_SOURCE_BYTES),
});
