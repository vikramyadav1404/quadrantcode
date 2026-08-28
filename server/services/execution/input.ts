/**
 * Zod at the execution boundary (C7).
 *
 * The caps here are the same numbers as the CHECK constraints in
 * `server/db/schema/execution.ts`, and both exist on purpose: Zod gives the
 * user a sentence, the constraint makes the limit true even when a service has
 * a bug. Whenever one changes the other has to, which is why both name the same
 * exported constant rather than a literal.
 *
 * Note what is NOT accepted: no verdict, no runtime, no timestamps. The client
 * describes what to run, never what happened — the same rule as the session
 * timer, for the same reason.
 */
import { z } from 'zod';
import { EXECUTION_LANGUAGES } from '@/lib/execution/languages';
import { MAX_SOURCE_BYTES, MAX_STDIN_BYTES } from '@/server/db/schema/execution';

export const submitExecutionSchema = z.object({
  problemId: z.string().uuid(),

  /**
   * The session this run belongs to, when there is one.
   *
   * Optional because the editor works without a timed session — see the
   * `session_id` column's note. A run outside a session is still a run.
   */
  sessionId: z.string().uuid().nullish(),

  language: z.enum(EXECUTION_LANGUAGES),

  source: z
    .string()
    .min(1, 'There is nothing to run.')
    .max(MAX_SOURCE_BYTES, `Keep the source under ${MAX_SOURCE_BYTES / 1024} KB.`),

  /** Empty stdin is normal; it is stored as null rather than as `''`. */
  stdin: z
    .string()
    .max(MAX_STDIN_BYTES, `Keep the input under ${MAX_STDIN_BYTES / 1024} KB.`)
    .nullish(),
});

export const executionIdSchema = z.object({
  jobId: z.string().uuid(),
});

export type SubmitExecutionInput = z.infer<typeof submitExecutionSchema>;
