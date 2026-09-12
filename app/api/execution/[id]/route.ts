/**
 * GET /api/execution/:id — where has this run got to?
 *
 * A route handler rather than a server action because the client polls it while
 * a run is live; an action would revalidate the layout every 700 ms.
 *
 * There is nothing to subscribe to — F2.3 is cut (D17), so the job row is the
 * queue and reading it is how progress is observed.
 */
import { NextResponse } from 'next/server';
import { getDb } from '@/server/db';
import { getCurrentUser } from '@/server/services/auth/session';
import { getExecution } from '@/server/services/execution';
import { executionIdSchema } from '@/server/services/execution/input';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ ok: false, message: 'Sign in first.' }, { status: 401 });
  }

  const parsed = executionIdSchema.safeParse({ jobId: (await params).id });
  if (!parsed.success) {
    return NextResponse.json({ ok: false, message: 'No such run.' }, { status: 400 });
  }

  const execution = await getExecution(getDb(), {
    userId: user.id,
    jobId: parsed.data.jobId,
  });

  /*
   * Scoped to the owner inside the service, so another user's run is a 404 and
   * not a 403 — a 403 would confirm the id exists, which the requester has no
   * claim to know. Same rule as the session routes.
   */
  if (!execution) {
    return NextResponse.json({ ok: false, message: 'No such run.' }, { status: 404 });
  }

  return NextResponse.json(execution);
}
