import { describe, expect, it } from 'vitest';
import { connectSrc, httpsOrigin } from '@/lib/security/connect-src';

/** Does a CSP host-source with a leading wildcard match this host? */
function cspMatches(source: string, origin: string): boolean {
  const { protocol, host } = new URL(origin);
  const [scheme, rest] = source.split('://');
  if (`${scheme}:` !== protocol || !rest) return false;
  if (rest.startsWith('*.')) return host.endsWith(rest.slice(1));
  return host === rest;
}

const allows = (list: string, origin: string) =>
  list.split(' ').some((source) => source !== "'self'" && cspMatches(source, origin));

describe('CSP connect-src', () => {
  it('ALLOWS A REGION-SCOPED SENTRY DSN — the shape production uses', () => {
    const list = connectSrc({});
    expect(allows(list, 'https://o4507000000000000.ingest.us.sentry.io')).toBe(true);
    expect(allows(list, 'https://o4507000000000000.ingest.de.sentry.io')).toBe(true);
    // The older, region-less shape still works.
    expect(allows(list, 'https://o123456.ingest.sentry.io')).toBe(true);
  });

  it('the old single wildcard did NOT cover the region shape (the bug)', () => {
    expect(allows('https://*.ingest.sentry.io', 'https://o1.ingest.us.sentry.io')).toBe(false);
  });

  it('adds the avatar bucket endpoint, origin only', () => {
    const list = connectSrc({
      S3_ENDPOINT: 'https://abc123.r2.cloudflarestorage.com/some/path',
    });
    expect(list).toContain('https://abc123.r2.cloudflarestorage.com');
    expect(list).not.toContain('/some/path');
    expect(allows(list, 'https://abc123.r2.cloudflarestorage.com')).toBe(true);
  });

  it('ignores a missing, malformed or non-https endpoint rather than widening the policy', () => {
    for (const S3_ENDPOINT of [undefined, '', 'not a url', 'http://plain.example.com']) {
      expect(connectSrc({ S3_ENDPOINT })).toBe(
        "'self' https://*.ingest.sentry.io https://*.ingest.us.sentry.io https://*.ingest.de.sentry.io",
      );
    }
    expect(httpsOrigin('javascript:alert(1)')).toBeNull();
  });
});
