/**
 * The origin a deployment will actually be reached at.
 *
 * Production has one fixed HTTPS origin, and `NEXT_PUBLIC_APP_URL` is it.
 *
 * Preview does not. Vercel mints a new hostname for every deployment, and it
 * does not interpolate environment variable values — so a single
 * `NEXT_PUBLIC_APP_URL` set on the Preview environment is correct for at most
 * one branch and wrong for every other. Leaving it unset is no better: it falls
 * back to the `http://localhost:3000` default in `lib/env.ts`, which
 * `deploy:check` rejects, and every preview build fails on a variable nobody
 * can set correctly.
 *
 * Vercel already publishes the answer as a build-time system variable, so the
 * origin is read from there on preview instead of being configured:
 *
 * - `VERCEL_BRANCH_URL` is preferred. It is stable for the branch, so a link
 *   from a preview still resolves after the next push to the same branch.
 * - `VERCEL_URL` is the fallback. It is unique per deployment, so it goes stale
 *   the moment another commit lands, but a stale-after-push origin beats an
 *   origin pointing at localhost.
 *
 * Deliberately scoped to `VERCEL_ENV === 'preview'`. Production must keep
 * failing when `NEXT_PUBLIC_APP_URL` is missing or wrong: that value is what
 * auth callbacks, emailed links and share cards are built from, and inferring
 * it there would turn a loud misconfiguration into a silent one.
 */
export type DeploymentOriginSource = 'NEXT_PUBLIC_APP_URL' | 'VERCEL_BRANCH_URL' | 'VERCEL_URL';

export interface ResolvedDeploymentOrigin {
  /** The origin to check and use. May be empty or unparseable — the caller reports that. */
  readonly url: string;
  /** Which variable it came from, so an error message can name the thing to fix. */
  readonly source: DeploymentOriginSource;
}

export interface DeploymentOriginEnv {
  readonly VERCEL_ENV?: string | undefined;
  readonly VERCEL_BRANCH_URL?: string | undefined;
  readonly VERCEL_URL?: string | undefined;
  readonly NEXT_PUBLIC_APP_URL?: string | undefined;
}

/** Vercel gives these as bare hostnames; a scheme is tolerated rather than assumed. */
function toHttpsOrigin(host: string): string {
  return `https://${host.replace(/^https?:\/\//i, '').replace(/\/+$/, '')}`;
}

export function resolveDeploymentOrigin(env: DeploymentOriginEnv): ResolvedDeploymentOrigin {
  if (env.VERCEL_ENV === 'preview') {
    const branch = env.VERCEL_BRANCH_URL?.trim();
    if (branch) return { url: toHttpsOrigin(branch), source: 'VERCEL_BRANCH_URL' };

    const deployment = env.VERCEL_URL?.trim();
    if (deployment) return { url: toHttpsOrigin(deployment), source: 'VERCEL_URL' };
  }

  return { url: env.NEXT_PUBLIC_APP_URL ?? '', source: 'NEXT_PUBLIC_APP_URL' };
}
