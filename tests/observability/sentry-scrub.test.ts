/**
 * Credentials never reach Sentry: the shape that leaked on 2026-11-14 is
 * scrubbed, and the parts worth keeping survive.
 */
import { describe, expect, it } from 'vitest';
import { type ScrubbableEvent, scrubSentryEvent, scrubUrl } from '@/lib/monitoring/scrub';

const TOKEN = '3f1c2b7a-9d4e-4c8b-8a1f-2e5d6c7b8a90';

describe('scrubSentryEvent', () => {
  it('drops the session cookie that leaked, in the shape it leaked', () => {
    // As captured by `Sentry.captureRequestError`: cookies as pairs.
    const event: ScrubbableEvent = {
      request: {
        url: 'https://quadrantcode.vikramyadav.me/api/ingest/export',
        cookies: [
          ['__Secure-quadrantcode.session', TOKEN],
          ['_ga', 'GA1.1.1309746560'],
        ],
        headers: [
          ['cookie', `__Secure-quadrantcode.session=${TOKEN}`],
          ['authorization', 'Bearer abc.def.ghi'],
          ['x-vercel-oidc-token', 'eyJhbGciOi'],
          ['user-agent', 'Mozilla/5.0'],
          ['accept', 'text/html'],
        ],
      },
    };

    const scrubbed = scrubSentryEvent(event);

    expect(JSON.stringify(scrubbed)).not.toContain(TOKEN);
    expect(scrubbed.request?.cookies).toBeUndefined();
    expect(scrubbed.request?.headers).toEqual([
      ['user-agent', 'Mozilla/5.0'],
      ['accept', 'text/html'],
    ]);
  });

  it('handles headers as an object too', () => {
    const scrubbed = scrubSentryEvent({
      request: { headers: { Cookie: `s=${TOKEN}`, 'X-Api-Key': 'k', Host: 'example.com' } },
    });
    expect(scrubbed.request?.headers).toEqual({ Host: 'example.com' });
  });

  it('filters credentials and addresses out of query strings, in every shape', () => {
    const asString = scrubSentryEvent({
      request: { query_string: `token=${TOKEN}&email=a%40b.com&callbackUrl=%2Fdashboard` },
    });
    expect(asString.request?.query_string).toBe(
      'token=%5BFiltered%5D&email=%5BFiltered%5D&callbackUrl=%2Fdashboard',
    );

    const asPairs = scrubSentryEvent({
      request: {
        query_string: [
          ['code', '123456'],
          ['page', '2'],
        ],
      },
    });
    expect(asPairs.request?.query_string).toEqual([
      ['code', '[Filtered]'],
      ['page', '2'],
    ]);

    const asObject = scrubSentryEvent({ request: { query_string: { otp: '9', view: 'all' } } });
    expect(asObject.request?.query_string).toEqual({ otp: '[Filtered]', view: 'all' });
  });

  it('scrubs the request URL and breadcrumb URLs, keeping the path', () => {
    const scrubbed = scrubSentryEvent({
      request: {
        url: `https://x.test/api/auth/callback/email?token=${TOKEN}&email=a%40b.com#top`,
      },
      breadcrumbs: [
        { data: { url: `/api/auth/callback/email?token=${TOKEN}` } },
        { data: null },
      ],
    });
    expect(scrubbed.request?.url).toBe(
      'https://x.test/api/auth/callback/email?token=%5BFiltered%5D&email=%5BFiltered%5D#top',
    );
    expect(JSON.stringify(scrubbed)).not.toContain(TOKEN);
  });

  it('leaves an event without request data alone', () => {
    const event = { message: 'boom', tags: { route: '/problems' } };
    expect(scrubSentryEvent(event)).toEqual({ message: 'boom', tags: { route: '/problems' } });
  });
});

describe('scrubUrl', () => {
  it('keeps a URL without a query unchanged', () => {
    expect(scrubUrl('/problems/two-sum')).toBe('/problems/two-sum');
  });
});
