import type { ServerEnv } from '@/server/env';

function enabled(value: string | undefined): boolean {
  return value === 'true' || value === '1';
}

/** Configuration that must exist for this deployment's enabled surface. */
export function readinessConfigIssues(
  env: ServerEnv,
  flags: Record<string, string | undefined> = process.env,
): string[] {
  if (env.NODE_ENV !== 'production') return [];

  const localTestRun =
    /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(env.NEXT_PUBLIC_APP_URL) &&
    env.ALLOW_IN_MEMORY_RATE_LIMIT === '1';
  if (localTestRun) return [];

  const issues: string[] = [];
  if (!env.UPSTASH_REDIS_REST_URL || !env.UPSTASH_REDIS_REST_TOKEN) {
    issues.push('distributed_rate_limit');
  }

  const email = Boolean(env.RESEND_API_KEY && env.EMAIL_FROM);
  const github = Boolean(env.GITHUB_ID && env.GITHUB_SECRET);
  if (!email && !github) issues.push('sign_in_provider');

  if (enabled(flags['FEATURE_PHONE_OTP']) && (!env.MSG91_AUTH_KEY || !env.MSG91_TEMPLATE_ID)) {
    issues.push('phone_delivery');
  }

  if (enabled(flags['FEATURE_EXECUTION']) && !env.JUDGE0_URL) {
    issues.push('code_execution');
  }

  return issues;
}
