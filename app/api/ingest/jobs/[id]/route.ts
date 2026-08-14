/**
 * GET /api/ingest/jobs/:id — import progress.
 *
 * The polling contract. It reads a row from `import_jobs`, which is the same
 * operation whether the work is being done by the in-process runner or, from
 * F2.3, by a BullMQ worker — so this handler does not change when the runner
 * does. That is the whole reason progress lives in the table rather than the
 * queue.
 */
import { NextResponse } from 'next/server';
import { getDb } from '@/server/db';
import { getCurrentUser } from '@/server/services/auth/session';
import { getJobProgress } from '@/server/services/ingest';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ ok: false, message: 'Sign in first.' }, { status: 401 });
  }

  const { id } = await params;

  /*
   * `getJobProgress` is scoped to the owner, so another user's job returns null
   * and therefore 404 — not 403. A 403 would confirm the job exists, which is
   * information the requester has no claim to.
   */
  const progress = await getJobProgress(getDb(), id, user.id);
  if (!progress) {
    return NextResponse.json({ ok: false, message: 'No such import.' }, { status: 404 });
  }

  return NextResponse.json({ ok: true, ...progress });
}
