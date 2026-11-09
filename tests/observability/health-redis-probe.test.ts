import { describe, expect, it } from 'vitest';
import { probeRedis } from '@/server/lib/observability/health';

const URL = 'https://example-db.upstash.io';
const TOKEN = 'gQAAAA-secret-token';

function fakeFetch(handler: () => Promise<Response>): typeof fetch {
  return (() => handler()) as unknown as typeof fetch;
}

describe('probeRedis', () => {
  it('is not_configured without both values', async () => {
    const result = await probeRedis(URL, undefined);
    expect(result.state).toBe('not_configured');
    expect(result.latencyMs).toBeNull();
  });

  it('is up when PING answers PONG', async () => {
    const result = await probeRedis(URL, TOKEN, {
      fetchImpl: fakeFetch(async () => Response.json({ result: 'PONG' })),
    });
    expect(result).toMatchObject({ name: 'redis', state: 'up', detail: 'PING answered PONG' });
  });

  it('is down with the HTTP status when Upstash refuses the token', async () => {
    const result = await probeRedis(URL, TOKEN, {
      fetchImpl: fakeFetch(
        async () => new Response('{"error":"Unauthorized"}', { status: 401 }),
      ),
    });
    expect(result).toMatchObject({
      state: 'down',
      detail: 'Upstash answered HTTP 401 to PING',
    });
  });

  it('names the system error code when the host does not resolve', async () => {
    const result = await probeRedis(URL, TOKEN, {
      fetchImpl: fakeFetch(async () => {
        throw new TypeError('fetch failed', {
          cause: Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND' }),
        });
      }),
    });
    expect(result).toMatchObject({ state: 'down', detail: 'could not connect (ENOTFOUND)' });
  });

  it('never echoes an error message, which can quote the token', async () => {
    const result = await probeRedis(URL, TOKEN, {
      fetchImpl: fakeFetch(async () => {
        throw new TypeError(`Headers.append: "Bearer ${TOKEN}"" is an invalid header value.`);
      }),
    });
    expect(result.state).toBe('down');
    expect(result.detail).not.toContain(TOKEN);
    expect(result.detail).toMatch(/could not be built/);
  });

  it('gives up after the timeout instead of hanging the dashboard', async () => {
    const result = await probeRedis(URL, TOKEN, {
      timeoutMs: 50,
      fetchImpl: ((_input: unknown, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(Object.assign(new Error('aborted'), { name: 'AbortError' })),
          );
        })) as unknown as typeof fetch,
    });
    expect(result).toMatchObject({ state: 'down', detail: 'no answer within 50ms' });
  });
});
