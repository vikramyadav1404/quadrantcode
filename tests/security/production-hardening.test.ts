import { afterEach, describe, expect, it } from 'vitest';
import { __testing } from '@/server/env';
import { clientIp } from '@/server/lib/client-ip';
import {
  FakeExecutionProvider,
  ProviderUnavailableError,
  UnavailableExecutionProvider,
  resolveProvider,
  resolveExecutionBackend,
} from '@/server/services/execution/provider';

const production = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://user:password@db.example/quadrantcode',
  NEXT_PUBLIC_APP_URL: 'https://quadrantcode.example',
  AUTH_SECRET: 'a-random-production-secret-longer-than-32-characters',
} as const;

describe('production environment contract', () => {
  it('rejects a missing or short Auth.js secret', () => {
    expect(() => __testing.parseServerEnv({ ...production, AUTH_SECRET: 'short' })).toThrow(
      /AUTH_SECRET/,
    );
  });

  it('rejects half-configured external providers', () => {
    expect(() =>
      __testing.parseServerEnv({ ...production, GITHUB_ID: 'only-one-half' }),
    ).toThrow(/GITHUB_ID and GITHUB_SECRET must be set together/);
    expect(() =>
      __testing.parseServerEnv({
        ...production,
        UPSTASH_REDIS_REST_URL: 'https://redis.example',
      }),
    ).toThrow(/UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN must be set together/);
  });
});

describe('production provider selection', () => {
  it('never substitutes a fake execution verdict in production', async () => {
    const provider = resolveProvider({ NODE_ENV: 'production' });
    expect(provider).toBeInstanceOf(UnavailableExecutionProvider);
    await expect(
      provider.execute({
        language: 'javascript',
        source: '1 + 1',
        stdin: null,
        expectedOutput: null,
      }),
    ).rejects.toBeInstanceOf(ProviderUnavailableError);
  });

  it('keeps the deterministic fake restricted to non-production development', () => {
    expect(resolveProvider({ NODE_ENV: 'development' })).toBeInstanceOf(FakeExecutionProvider);
    expect(
      resolveProvider({ NODE_ENV: 'production', EXECUTION_BACKEND: 'fake' }),
    ).toBeInstanceOf(UnavailableExecutionProvider);
  });

  it('never automatically falls back from Sandbox to Judge0', () => {
    expect(
      resolveExecutionBackend({
        NODE_ENV: 'production',
        EXECUTION_BACKEND: 'vercel_sandbox',
        JUDGE0_URL: 'https://judge.example',
      }),
    ).toBe('vercel_sandbox');
    expect(
      resolveProvider({
        NODE_ENV: 'production',
        EXECUTION_BACKEND: 'vercel_sandbox',
        JUDGE0_URL: 'https://judge.example',
      }),
    ).toBeInstanceOf(UnavailableExecutionProvider);
  });

  it('rejects a mutable Sandbox image reference in server configuration', () => {
    expect(() =>
      __testing.parseServerEnv({
        ...production,
        EXECUTION_BACKEND: 'vercel_sandbox',
        EXECUTION_SANDBOX_IMAGE: 'quadrantcode-execution:latest',
      }),
    ).toThrow(/immutable sha256 digest/);
  });
});

describe('client address trust boundary', () => {
  const previousVercel = process.env.VERCEL;
  const previousTrustProxy = process.env.TRUST_PROXY;

  afterEach(() => {
    if (previousVercel === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = previousVercel;
    if (previousTrustProxy === undefined) delete process.env.TRUST_PROXY;
    else process.env.TRUST_PROXY = previousTrustProxy;
  });

  it('uses Vercel-overwritten forwarding headers on Vercel', () => {
    process.env.VERCEL = '1';
    const request = new Request('https://quadrantcode.example', {
      headers: { 'x-vercel-forwarded-for': '203.0.113.9', 'x-forwarded-for': '198.51.100.7' },
    });
    expect(clientIp(request)).toBe('203.0.113.9');
  });

  it('does not trust a caller-supplied forwarded address by default', () => {
    delete process.env.VERCEL;
    delete process.env.TRUST_PROXY;
    const request = new Request('http://localhost', {
      headers: { 'x-forwarded-for': '203.0.113.9' },
    });
    expect(clientIp(request)).toBe('unknown');
  });
});
