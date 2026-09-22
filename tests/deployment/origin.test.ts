/**
 * The origin `deploy:check` validates.
 *
 * This exists because every preview build failed on `NEXT_PUBLIC_APP_URL`, a
 * variable that cannot be set correctly for the Preview environment: Vercel
 * mints a hostname per deployment and does not interpolate env values, so one
 * configured value is right for at most one branch.
 *
 * The rule worth protecting is narrow, and both halves matter. Preview reads
 * the origin from Vercel. Production does NOT — inferring it there would turn a
 * missing auth/callback origin from a failed build into a silently wrong
 * deployment, which is the more expensive failure.
 */
import { describe, expect, it } from 'vitest';
import { resolveDeploymentOrigin } from '@/lib/deployment/origin';

const CONFIGURED = 'https://quadrantcode.app';

describe('resolveDeploymentOrigin · production and everything that is not preview', () => {
  it('uses NEXT_PUBLIC_APP_URL on production, even when Vercel offers a hostname', () => {
    // The negative half of the rule: VERCEL_URL is present and ignored.
    expect(
      resolveDeploymentOrigin({
        VERCEL_ENV: 'production',
        VERCEL_URL: 'quadrantcode-abc123.vercel.app',
        VERCEL_BRANCH_URL: 'quadrantcode-git-main.vercel.app',
        NEXT_PUBLIC_APP_URL: CONFIGURED,
      }),
    ).toEqual({ url: CONFIGURED, source: 'NEXT_PUBLIC_APP_URL' });
  });

  it('uses NEXT_PUBLIC_APP_URL when VERCEL_ENV is absent entirely', () => {
    expect(resolveDeploymentOrigin({ NEXT_PUBLIC_APP_URL: CONFIGURED })).toEqual({
      url: CONFIGURED,
      source: 'NEXT_PUBLIC_APP_URL',
    });
  });

  it('does NOT invent an origin for production when the variable is missing', () => {
    // An empty url is what makes deploy:check fail, which is the point. If this
    // ever returned a Vercel hostname, a production deploy with no configured
    // origin would succeed and send people links to the wrong host.
    const resolved = resolveDeploymentOrigin({
      VERCEL_ENV: 'production',
      VERCEL_URL: 'quadrantcode-abc123.vercel.app',
    });
    expect(resolved).toEqual({ url: '', source: 'NEXT_PUBLIC_APP_URL' });
    expect(() => new URL(resolved.url)).toThrow();
  });
});

describe('resolveDeploymentOrigin · preview', () => {
  it('prefers the stable branch URL over the per-deployment one', () => {
    expect(
      resolveDeploymentOrigin({
        VERCEL_ENV: 'preview',
        VERCEL_BRANCH_URL: 'quadrantcode-git-my-branch.vercel.app',
        VERCEL_URL: 'quadrantcode-abc123.vercel.app',
        NEXT_PUBLIC_APP_URL: 'http://localhost:3000',
      }),
    ).toEqual({
      url: 'https://quadrantcode-git-my-branch.vercel.app',
      source: 'VERCEL_BRANCH_URL',
    });
  });

  it('falls back to VERCEL_URL when no branch URL is published', () => {
    expect(
      resolveDeploymentOrigin({
        VERCEL_ENV: 'preview',
        VERCEL_URL: 'quadrantcode-abc123.vercel.app',
        NEXT_PUBLIC_APP_URL: 'http://localhost:3000',
      }),
    ).toEqual({ url: 'https://quadrantcode-abc123.vercel.app', source: 'VERCEL_URL' });
  });

  it('treats an empty or blank branch URL as absent', () => {
    // `VERCEL_BRANCH_URL=` set-but-empty must not win and produce "https://".
    expect(
      resolveDeploymentOrigin({
        VERCEL_ENV: 'preview',
        VERCEL_BRANCH_URL: '   ',
        VERCEL_URL: 'quadrantcode-abc123.vercel.app',
      }).source,
    ).toBe('VERCEL_URL');
  });

  it('produces an https origin from the bare hostname Vercel actually supplies', () => {
    const { url } = resolveDeploymentOrigin({
      VERCEL_ENV: 'preview',
      VERCEL_BRANCH_URL: 'quadrantcode-git-my-branch.vercel.app',
    });
    const origin = new URL(url);
    expect(origin.protocol).toBe('https:');
    expect(origin.hostname).toBe('quadrantcode-git-my-branch.vercel.app');
  });

  it('tolerates a scheme already being present rather than doubling it', () => {
    expect(
      resolveDeploymentOrigin({
        VERCEL_ENV: 'preview',
        VERCEL_BRANCH_URL: 'https://quadrantcode-git-my-branch.vercel.app/',
      }).url,
    ).toBe('https://quadrantcode-git-my-branch.vercel.app');
  });

  it('upgrades an http hostname to https', () => {
    expect(
      resolveDeploymentOrigin({
        VERCEL_ENV: 'preview',
        VERCEL_BRANCH_URL: 'http://quadrantcode-git-my-branch.vercel.app',
      }).url,
    ).toBe('https://quadrantcode-git-my-branch.vercel.app');
  });

  it('falls back to NEXT_PUBLIC_APP_URL when Vercel supplies nothing', () => {
    expect(
      resolveDeploymentOrigin({ VERCEL_ENV: 'preview', NEXT_PUBLIC_APP_URL: CONFIGURED }),
    ).toEqual({ url: CONFIGURED, source: 'NEXT_PUBLIC_APP_URL' });
  });
});

describe('resolveDeploymentOrigin · what deploy:check does with the result', () => {
  /** The assertion from `scripts/check-deployment-env.ts`, mirrored. */
  const rejected = (url: string) => {
    let origin: URL;
    try {
      origin = new URL(url);
    } catch {
      return true;
    }
    return origin.protocol !== 'https:' || /^(localhost|127\.0\.0\.1)$/i.test(origin.hostname);
  };

  it('the preview default that was failing every build is still rejected elsewhere', () => {
    // Positive control for the check itself: localhost must fail, or these
    // tests would pass no matter what resolveDeploymentOrigin returned.
    expect(rejected('http://localhost:3000')).toBe(true);
    expect(rejected('http://127.0.0.1:3000')).toBe(true);
    expect(rejected('')).toBe(true);
    expect(rejected(CONFIGURED)).toBe(false);
  });

  it('a preview build now passes the check it used to fail', () => {
    const { url } = resolveDeploymentOrigin({
      VERCEL_ENV: 'preview',
      VERCEL_BRANCH_URL: 'quadrantcode-git-my-branch.vercel.app',
      NEXT_PUBLIC_APP_URL: 'http://localhost:3000',
    });
    expect(rejected(url)).toBe(false);
  });

  it('a production build with no configured origin still fails it', () => {
    const { url } = resolveDeploymentOrigin({
      VERCEL_ENV: 'production',
      VERCEL_URL: 'quadrantcode-abc123.vercel.app',
    });
    expect(rejected(url)).toBe(true);
  });
});
