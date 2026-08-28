'use server';

/**
 * The timer bar's server actions.
 *
 * Thin adapters, in the project's usual shape: authenticate, validate, call the
 * service, map a typed error to a message. **Every one of them resolves `now`
 * here, server-side** — the action signature has no place to put a time, which
 * is what makes "the client sends intent only" a property of the code rather
 * than a rule someone has to remember.
 *
 * Lives in its own folder rather than beside a page because the timer bar is in
 * the layout: it is on every authenticated screen, so its actions belong to
 * none of them in particular. The folder holds no `page.tsx`, so it is not a
 * route — and the filename is `actions.ts` because that is the path the server
 * boundary rule exempts. The first version was `session-actions.ts` and lint
 * refused it, correctly: the fix is to match the convention, not to widen the
 * pattern that guards the client bundle.
 */
import { revalidatePath } from 'next/cache';
import { getDb } from '@/server/db';
import { requireCurrentUser } from '@/server/services/auth/session';
import {
  ActiveSessionExistsError,
  IllegalTransitionError,
  SessionNotFoundError,
  type SessionView,
  abandonSession,
  completeSession,
  pauseSession,
  resumeSession,
  startSession,
} from '@/server/services/session';
import {
  completeSessionSchema,
  sessionIdSchema,
  startSessionSchema,
} from '@/server/services/session/input';

export type SessionActionResult =
  | { ok: true; session: SessionView | null }
  /** `conflictWith` is the running session, so the UI can offer finish-or-abandon. */
  | { ok: false; message: string; conflictWith?: { id: string; problemId: string } };

/**
 * One place that turns a typed error into something a user reads.
 *
 * Anything unrecognised is re-thrown rather than flattened into "something went
 * wrong": swallowing an unknown failure here would hide a real bug behind a
 * toast, and the errors this service raises are all deliberate.
 */
function toResult(error: unknown): SessionActionResult {
  if (error instanceof ActiveSessionExistsError) {
    return {
      ok: false,
      message: error.message,
      conflictWith: { id: error.existing.id, problemId: error.existing.problemId },
    };
  }

  if (error instanceof IllegalTransitionError || error instanceof SessionNotFoundError) {
    return { ok: false, message: error.message };
  }

  throw error;
}

/** Refresh every surface that shows session or streak state. */
function revalidateShell(): void {
  revalidatePath('/', 'layout');
}

export async function startSessionAction(input: unknown): Promise<SessionActionResult> {
  const user = await requireCurrentUser();
  const parsed = startSessionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: 'That problem is not valid.' };

  try {
    const session = await startSession(getDb(), {
      userId: user.id,
      timeZone: user.timezone,
      now: new Date(),
      problemId: parsed.data.problemId,
    });
    revalidateShell();
    return { ok: true, session };
  } catch (error) {
    return toResult(error);
  }
}

export async function pauseSessionAction(input: unknown): Promise<SessionActionResult> {
  return act(input, pauseSession);
}

export async function resumeSessionAction(input: unknown): Promise<SessionActionResult> {
  return act(input, resumeSession);
}

export async function abandonSessionAction(input: unknown): Promise<SessionActionResult> {
  return act(input, abandonSession);
}

export async function completeSessionAction(input: unknown): Promise<SessionActionResult> {
  const user = await requireCurrentUser();
  const parsed = completeSessionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: 'That outcome is not valid.' };

  try {
    const session = await completeSession(getDb(), {
      userId: user.id,
      timeZone: user.timezone,
      now: new Date(),
      sessionId: parsed.data.sessionId,
      outcome: parsed.data.outcome,
      ...(parsed.data.confidence ? { confidence: parsed.data.confidence } : {}),
    });
    revalidateShell();
    return { ok: true, session };
  } catch (error) {
    return toResult(error);
  }
}

/** Shared by the three actions whose only input is a session id. */
async function act(
  input: unknown,
  operation: (
    db: ReturnType<typeof getDb>,
    args: { userId: string; timeZone: string; now: Date; sessionId: string },
  ) => Promise<SessionView>,
): Promise<SessionActionResult> {
  const user = await requireCurrentUser();
  const parsed = sessionIdSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: 'That session is not valid.' };

  try {
    const session = await operation(getDb(), {
      userId: user.id,
      timeZone: user.timezone,
      now: new Date(),
      sessionId: parsed.data.sessionId,
    });
    revalidateShell();
    return { ok: true, session };
  } catch (error) {
    return toResult(error);
  }
}
