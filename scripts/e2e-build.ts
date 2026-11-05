/**
 * `npm run e2e:build`: `next build` for the browser suite, with production's
 * other services blanked (issue #32).
 *
 * A plain `next build` reads `.env.local`. With production values there it
 * would upload source maps to the production Sentry project
 * (`SENTRY_AUTH_TOKEN`), and inline the production browser DSN
 * (`NEXT_PUBLIC_SENTRY_DSN`) into the bundle the e2e suite then runs, so
 * errors from deliberately hostile fixtures would be reported as real ones.
 * Blanking them here, before Next loads `.env.local`, keeps both out: Next
 * never overrides a variable that is already set, even to the empty string.
 *
 * CI's browser jobs build with this too, so the script is exercised on every
 * run, although CI sets none of these variables.
 */
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import {
  assertNoProductionServices,
  blankProductionServices,
} from '@/lib/db/production-services';

const env = { ...process.env };
blankProductionServices(env);
assertNoProductionServices(env, 'scripts/e2e-build.ts');

// Next's own entry point, run with this Node: no shell, the same on Windows.
const nextBin = createRequire(import.meta.url).resolve('next/dist/bin/next');
const result = spawnSync(process.execPath, [nextBin, 'build'], { env, stdio: 'inherit' });

process.exit(result.status ?? 1);
