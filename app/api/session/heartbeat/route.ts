/**
 * POST /api/session/heartbeat — "I am still here."
 *
 * A route handler rather than a server action because it fires every 30
 * seconds from a running client, and an action would revalidate the layout on
 * each one.
 *
 * **The body is a session id and nothing else.** No elapsed count, no client
 * clock. The instant recorded is `new Date()` on this line, so a client that
 * lies about the time is describing a field the server never reads — see
 * `server/services/session/input.ts`.
 */
import { NextResponse } from 'next/server';
import { getDb } from '@/server/db';
import { getCurrentUser } from '@/server/services/auth/session';
import { SessionNotFoundError, heartbeat } from '@/server/services/session';
import { sessionIdSchema } from '@/server/services/session/input';

export async function POST(request: Request): Promise<NextResponse> {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ ok: false, message: 'Sign in first.' }, { status: 401 });
  }

  const parsed = sessionIdSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, message: 'No session given.' }, { status: 400 });
  }

  try {
    const session = await heartbeat(getDb(), {
      userId: user.id,
      timeZone: user.timezone,
      now: new Date(),
      sessionId: parsed.data.sessionId,
    });

    return NextResponse.json({
      ok: true,
      status: session.status,
      activeDurationSeconds: session.activeDurationSeconds,
    });
  } catch (error) {
    /*
     * Scoped to the owner inside the service, so another user's session is a
     * 404 — not a 403. A 403 would confirm the id exists, which the requester
     * has no claim to know (the IDOR rule F4.8 makes explicit).
     */
    if (error instanceof SessionNotFoundError) {
      return NextResponse.json({ ok: false, message: error.message }, { status: 404 });
    }
    throw error;
  }
}
