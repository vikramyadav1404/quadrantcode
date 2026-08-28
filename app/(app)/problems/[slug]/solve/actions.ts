'use server';

/**
 * Submitting a run.
 *
 * A server action rather than a route handler because it happens on a click and
 * benefits from the typed round trip. The POLL is a route handler
 * (`/api/execution/[id]`) — it fires every 700 ms and an action would
 * revalidate the layout on each one.
 *
 * `now` is resolved here, server-side, and the runner is chosen here. The
 * client sends what to run and nothing about when.
 */
import { getDb } from '@/server/db';
import { getServerEnv } from '@/server/env';
import { requireCurrentUser } from '@/server/services/auth/session';
import {
  InProcessExecutionRunner,
  resolveProvider,
  submitExecution,
} from '@/server/services/execution';
import { submitExecutionSchema } from '@/server/services/execution/input';

export type SubmitRunResult = { ok: true; jobId: string } | { ok: false; message: string };

export async function submitRunAction(input: unknown): Promise<SubmitRunResult> {
  const user = await requireCurrentUser();

  const parsed = submitExecutionSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      // The first message, because a form with one field does not need a list.
      message: parsed.error.issues[0]?.message ?? 'That submission was not valid.',
    };
  }

  const result = await submitExecution(getDb(), {
    userId: user.id,
    problemId: parsed.data.problemId,
    sessionId: parsed.data.sessionId ?? null,
    language: parsed.data.language,
    source: parsed.data.source,
    stdin: parsed.data.stdin ?? null,
    now: new Date(),
    /*
     * With no `JUDGE0_URL` this resolves to the fake, which executes nothing.
     * That is the deployed state today and it is visible here rather than
     * hidden inside the pipeline: the page works, the results are not real
     * execution, and the acceptance record says so.
     */
    runner: new InProcessExecutionRunner(getDb(), resolveProvider(getServerEnv())),
  });

  /*
   * A refusal comes back with the limit's own message — the one that names the
   * time capacity returns. Flattening it to "try again later" here would throw
   * away the only part the user can act on.
   */
  return result.ok
    ? { ok: true, jobId: result.jobId }
    : { ok: false, message: result.limit.message };
}
