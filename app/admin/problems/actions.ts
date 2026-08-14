'use server';

/**
 * Admin server actions.
 *
 * Thin adapters: every action re-checks the role server-side and hands the
 * payload straight to the service. The SAME Zod schema the client form uses is
 * re-run here — a client-side parse is a convenience for the user, never a
 * security boundary, because the request can be made without the form.
 */
import { revalidatePath } from 'next/cache';
import { getDb } from '@/server/db';
import { requireCurrentUser } from '@/server/services/auth/session';
import {
  ContentPolicyError,
  DuplicateSlugError,
  archiveProblem,
  bulkUpdateTags,
  createProblem,
  unarchiveProblem,
  updateProblem,
} from '@/server/services/problems';

export type ActionResult = { ok: true } | { ok: false; message: string; fields?: string[] };

/**
 * Maps a typed service error to something an admin can act on.
 * An unrecognised error is re-thrown — swallowing it would hide a real bug
 * behind a friendly message.
 */
function toResult(error: unknown): ActionResult {
  if (error instanceof ContentPolicyError) {
    return {
      ok: false,
      message: error.message,
      fields: error.violations.map((violation) => violation.field),
    };
  }
  if (error instanceof DuplicateSlugError) {
    return { ok: false, message: error.message, fields: ['slug'] };
  }
  if (error instanceof Error && error.name === 'ZodError') {
    return { ok: false, message: 'Some fields are invalid. Check the highlighted inputs.' };
  }
  throw error;
}

export async function createProblemAction(payload: unknown): Promise<ActionResult> {
  await requireCurrentUser('admin');
  try {
    await createProblem(getDb(), payload);
    revalidatePath('/admin/problems');
    revalidatePath('/problems');
    return { ok: true };
  } catch (error) {
    return toResult(error);
  }
}

export async function updateProblemAction(payload: unknown): Promise<ActionResult> {
  await requireCurrentUser('admin');
  try {
    await updateProblem(getDb(), payload);
    revalidatePath('/admin/problems');
    revalidatePath('/problems');
    return { ok: true };
  } catch (error) {
    return toResult(error);
  }
}

export async function archiveProblemAction(id: string): Promise<ActionResult> {
  await requireCurrentUser('admin');
  try {
    await archiveProblem(getDb(), id);
    revalidatePath('/admin/problems');
    revalidatePath('/problems');
    return { ok: true };
  } catch (error) {
    return toResult(error);
  }
}

export async function unarchiveProblemAction(id: string): Promise<ActionResult> {
  await requireCurrentUser('admin');
  try {
    await unarchiveProblem(getDb(), id);
    revalidatePath('/admin/problems');
    revalidatePath('/problems');
    return { ok: true };
  } catch (error) {
    return toResult(error);
  }
}

export async function bulkTagAction(payload: unknown): Promise<ActionResult> {
  await requireCurrentUser('admin');
  try {
    await bulkUpdateTags(getDb(), payload);
    revalidatePath('/admin/problems');
    return { ok: true };
  } catch (error) {
    return toResult(error);
  }
}
