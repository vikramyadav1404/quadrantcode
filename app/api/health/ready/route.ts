import { NextResponse } from 'next/server';
import { getDb } from '@/server/db';
import { getServerEnv } from '@/server/env';
import { checkHealth, readinessConfigIssues } from '@/server/lib/observability';

/** Readiness: required dependencies and enabled features, with no secret detail. */
export async function GET(): Promise<NextResponse> {
  const env = getServerEnv();
  const report = await checkHealth(getDb(), process.env, new Date());
  const postgres = report.dependencies.find((entry) => entry.name === 'postgres')?.state;
  const missing = readinessConfigIssues(env);
  const ready = postgres === 'up' && missing.length === 0;

  return NextResponse.json(
    {
      status: ready ? 'ready' : 'not_ready',
      checkedAt: report.checkedAt.toISOString(),
      required: {
        postgres: postgres === 'up' ? 'up' : 'down',
        configuration: missing.length === 0 ? 'up' : 'down',
      },
      optional: {
        execution: env.JUDGE0_URL ? 'configured' : 'unavailable',
        monitoring: env.SENTRY_DSN ? 'configured' : 'unavailable',
        avatarStorage:
          env.S3_ENDPOINT && env.S3_BUCKET && env.S3_PUBLIC_BASE_URL
            ? 'configured'
            : 'unavailable',
      },
    },
    { status: ready ? 200 : 503, headers: { 'cache-control': 'no-store' } },
  );
}
