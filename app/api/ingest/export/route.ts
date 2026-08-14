/**
 * GET /api/ingest/export — the user's tracked list as CSV.
 *
 * Streams as a download rather than JSON: the deliverable is a file someone
 * opens in a spreadsheet, and every cell has been through `escapeCell` so that
 * opening it cannot execute a formula. See spreadsheet-safety.ts.
 */
import { getDb } from '@/server/db';
import { getServerEnv } from '@/server/env';
import { RATE_LIMITS, createRateLimiter } from '@/server/lib/ratelimit';
import { getCurrentUser } from '@/server/services/auth/session';
import { exportTrackedCsv } from '@/server/services/ingest';

export async function GET(): Promise<Response> {
  const user = await getCurrentUser();
  if (!user) {
    return Response.json({ ok: false, message: 'Sign in first.' }, { status: 401 });
  }

  const gate = await createRateLimiter(RATE_LIMITS.exportPerUser, getServerEnv()).limit(
    user.id,
  );
  if (!gate.allowed) {
    return Response.json(
      { ok: false, message: 'Too many exports this hour. Try again later.' },
      { status: 429 },
    );
  }

  const { csv, rowCount, omittedArchived } = await exportTrackedCsv(getDb(), user.id);

  const stamp = new Date().toISOString().slice(0, 10);

  return new Response(csv, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="traceloop-problems-${stamp}.csv"`,
      // Surfaced as headers so the UI can tell the user what was left out
      // rather than the omission being silent. See export.ts.
      'x-traceloop-rows': String(rowCount),
      'x-traceloop-omitted-archived': String(omittedArchived),
      'cache-control': 'no-store',
    },
  });
}
