/**
 * GET /api/health — the uptime endpoint.
 *
 * Public and unauthenticated on purpose: an uptime probe cannot hold a session,
 * and a health check behind auth answers "is auth working" rather than "is the
 * system up".
 *
 * It therefore says as little as possible. Dependency NAMES and states, never
 * an error message from Postgres and never a configuration value — a health
 * endpoint is a reconnaissance surface, and "which of your dependencies are
 * missing" is already more than a stranger needs.
 */
import { NextResponse } from 'next/server';
import { getDb } from '@/server/db';
import { checkHealth } from '@/server/lib/observability';

export async function GET(): Promise<NextResponse> {
  const report = await checkHealth(getDb(), process.env, new Date());

  return NextResponse.json(
    {
      status: report.status,
      checkedAt: report.checkedAt.toISOString(),
      // States only. The `detail` lines are for the authenticated dashboard.
      dependencies: Object.fromEntries(
        report.dependencies.map((entry) => [entry.name, entry.state]),
      ),
    },
    {
      // 503 when the database is gone, so a probe reacts without parsing a body.
      status: report.status === 'down' ? 503 : 200,
      headers: { 'cache-control': 'no-store' },
    },
  );
}
