/** Fails a deployment before compilation when its production contract is incomplete. */
import 'dotenv/config';
import { __testing } from '@/server/env';

const env = __testing.parseServerEnv(process.env);
const issues: string[] = [];

if (process.env.E2E_EMAIL_CAPTURE === '1') {
  issues.push('E2E_EMAIL_CAPTURE must never be enabled in a deployment');
}

const origin = new URL(env.NEXT_PUBLIC_APP_URL);
if (origin.protocol !== 'https:' || /^(localhost|127\.0\.0\.1)$/i.test(origin.hostname)) {
  issues.push('NEXT_PUBLIC_APP_URL must be the final HTTPS deployment origin');
}

if (!env.UPSTASH_REDIS_REST_URL || !env.UPSTASH_REDIS_REST_TOKEN) {
  issues.push('Upstash REST URL and token are required for distributed auth rate limiting');
}

const email = Boolean(env.RESEND_API_KEY && env.EMAIL_FROM);
const github = Boolean(env.GITHUB_ID && env.GITHUB_SECRET);
if (!email && !github)
  issues.push('configure at least one real sign-in provider (Resend or GitHub)');

if (process.env.FEATURE_PHONE_OTP === 'true' && !env.MSG91_AUTH_KEY) {
  issues.push('MSG91 credentials are required while FEATURE_PHONE_OTP=true');
}
if (process.env.FEATURE_EXECUTION === 'true') {
  if (!env.EXECUTION_BACKEND) {
    issues.push('EXECUTION_BACKEND is required while FEATURE_EXECUTION=true');
  } else if (env.EXECUTION_BACKEND === 'vercel_sandbox') {
    if (!/^.+@sha256:[a-f0-9]{64}$/i.test(env.EXECUTION_SANDBOX_IMAGE ?? '')) {
      issues.push('EXECUTION_SANDBOX_IMAGE must be an immutable digest reference');
    }
    if (!env.CRON_SECRET || env.CRON_SECRET.length < 32) {
      issues.push('CRON_SECRET must contain at least 32 characters');
    }
  } else if (env.EXECUTION_BACKEND === 'judge0' && !env.JUDGE0_URL) {
    issues.push('JUDGE0_URL is required when EXECUTION_BACKEND=judge0');
  } else if (env.EXECUTION_BACKEND === 'fake') {
    issues.push('fake execution cannot be enabled in production');
  }
}
if (!env.SENTRY_DSN || !env.NEXT_PUBLIC_SENTRY_DSN) {
  issues.push('server and public Sentry DSNs are required for production monitoring');
}
if (!env.NEXT_PUBLIC_SUPPORT_EMAIL) {
  issues.push('NEXT_PUBLIC_SUPPORT_EMAIL is required for the public support surface');
}

if (issues.length > 0) {
  console.error('Deployment environment is not production-ready:');
  for (const issue of issues) console.error(`  - ${issue}`);
  process.exit(1);
}

console.log('deployment environment contract is valid');
