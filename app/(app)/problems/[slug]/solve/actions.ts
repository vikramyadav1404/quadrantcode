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
import { captureSnapshot } from '@/server/services/timeline';
import { snapshotCaptureEnabled } from '@/server/services/profile';

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
  if (!result.ok) return { ok: false, message: result.limit.message };

  /*
   * F3.2 · snapshot the source that was just submitted.
   *
   * This closes the half of the ticket D24 deferred: F3.1 autosaves drafts to
   * localStorage, and the server-side record waited for the table that owns
   * code history rather than getting a second home of its own.
   *
   * Only inside a session. `code_snapshots.session_id` is NOT NULL because a
   * snapshot is part of a sitting — a run with no session is a scratch run, and
   * inventing a session to hold it would put a sitting in the user's history
   * that they never started.
   *
   * After the submission, never before: a snapshot for a run that was refused
   * by the rate limit is a record of something that did not happen. And it must
   * not be able to fail the run — the code is already queued, and losing a
   * snapshot is worth strictly less than losing the run.
   */
  if (parsed.data.sessionId) {
    try {
      await captureSnapshot(getDb(), {
        sessionId: parsed.data.sessionId,
        userId: user.id,
        language: parsed.data.language,
        source: parsed.data.source,
        trigger: 'run_attempt',
        occurredAt: new Date(),
        /*
         * The user's own setting, from `/settings/privacy`. Read here rather
         * than passed in: a client that could send `enabled: true` would be
         * able to switch capture back on for someone who turned it off.
         */
        enabled: await snapshotCaptureEnabled(getDb(), user.id),
      });
    } catch (error) {
      console.error(
        JSON.stringify({
          event: 'timeline.snapshot_failed',
          sessionId: parsed.data.sessionId,
          reason: error instanceof Error ? error.message : 'unknown',
        }),
      );
    }
  }

  return { ok: true, jobId: result.jobId };
}
