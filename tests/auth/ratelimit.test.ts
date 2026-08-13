/**
 * F0.3 · rate limiting.
 *
 * The OTP endpoints are limited by BOTH phone number and IP. Per-phone alone
 * lets one host walk a list of numbers; per-IP alone lets a botnet hammer one
 * number. `checkAll` is what enforces "first denial wins".
 */
import { describe, expect, it } from 'vitest';
import {
  RATE_LIMITS,
  checkAll,
  createMemoryRateLimiter,
  createRateLimiter,
  createUpstashRateLimiter,
} from '@/server/lib/ratelimit';

describe('F0.3 · fixed-window limiter', () => {
  it('allows exactly `limit` requests, then denies', async () => {
    const limiter = createMemoryRateLimiter({ limit: 3, windowSeconds: 3600, prefix: 't' });

    for (let i = 0; i < 3; i += 1) {
      expect((await limiter.limit('key')).allowed).toBe(true);
    }
    expect((await limiter.limit('key')).allowed).toBe(false);
  });

  it('reports a reset time the caller can show the user', async () => {
    const limiter = createMemoryRateLimiter({ limit: 1, windowSeconds: 900, prefix: 't' });
    await limiter.limit('key');
    const denied = await limiter.limit('key');

    expect(denied.allowed).toBe(false);
    expect(denied.resetAt.getTime()).toBeGreaterThan(Date.now());
    expect(denied.resetAt.getTime()).toBeLessThanOrEqual(Date.now() + 900_000);
  });

  it('keys are independent', async () => {
    const limiter = createMemoryRateLimiter({ limit: 1, windowSeconds: 3600, prefix: 't' });
    expect((await limiter.limit('a')).allowed).toBe(true);
    expect((await limiter.limit('b')).allowed).toBe(true);
    expect((await limiter.limit('a')).allowed).toBe(false);
  });

  it('starts a fresh window after expiry', async () => {
    let now = 1_000_000;
    const limiter = createMemoryRateLimiter(
      { limit: 1, windowSeconds: 60, prefix: 't' },
      () => now,
    );

    expect((await limiter.limit('k')).allowed).toBe(true);
    expect((await limiter.limit('k')).allowed).toBe(false);

    now += 61_000;
    expect((await limiter.limit('k')).allowed).toBe(true);
  });
});

describe('F0.3 · checkAll composes phone and IP limits', () => {
  it('denies when EITHER dimension is exhausted', async () => {
    const perPhone = createMemoryRateLimiter({ limit: 3, windowSeconds: 3600, prefix: 'p' });
    const perIp = createMemoryRateLimiter({ limit: 100, windowSeconds: 3600, prefix: 'i' });

    const call = () =>
      checkAll([
        { limiter: perPhone, key: '+919876543210' },
        { limiter: perIp, key: '1.2.3.4' },
      ]);

    for (let i = 0; i < 3; i += 1) expect((await call()).allowed).toBe(true);
    expect((await call()).allowed).toBe(false);
  });

  it('denies on the IP dimension even when the phone is fresh', async () => {
    const perPhone = createMemoryRateLimiter({ limit: 100, windowSeconds: 3600, prefix: 'p' });
    const perIp = createMemoryRateLimiter({ limit: 2, windowSeconds: 3600, prefix: 'i' });

    // Two different numbers from the same host.
    await checkAll([
      { limiter: perPhone, key: '+911111111111' },
      { limiter: perIp, key: '9.9.9.9' },
    ]);
    await checkAll([
      { limiter: perPhone, key: '+912222222222' },
      { limiter: perIp, key: '9.9.9.9' },
    ]);

    const third = await checkAll([
      { limiter: perPhone, key: '+913333333333' },
      { limiter: perIp, key: '9.9.9.9' },
    ]);
    expect(third.allowed).toBe(false);
  });
});

describe('F0.3 · limiter selection', () => {
  it('refuses the in-memory limiter in production', () => {
    expect(() =>
      createRateLimiter(RATE_LIMITS.otpRequestPerPhone, { NODE_ENV: 'production' }),
    ).toThrow(/required in production/);
  });

  it('falls back to in-memory outside production', () => {
    expect(() =>
      createRateLimiter(RATE_LIMITS.otpRequestPerPhone, { NODE_ENV: 'test' }),
    ).not.toThrow();
  });

  it('fails CLOSED when Upstash is unreachable', async () => {
    const limiter = createUpstashRateLimiter(RATE_LIMITS.otpRequestPerPhone, {
      url: 'https://example.invalid',
      token: 'token',
      fetchImpl: () => Promise.resolve(new Response('nope', { status: 503 })),
    });

    // An unavailable limiter must not become an open door on an auth endpoint.
    await expect(limiter.limit('+919876543210')).rejects.toThrow(/rate limiter unavailable/);
  });

  it('counts through the Upstash pipeline response', async () => {
    const limiter = createUpstashRateLimiter(
      { limit: 3, windowSeconds: 3600, prefix: 'p' },
      {
        url: 'https://example.test',
        token: 'token',
        fetchImpl: () =>
          Promise.resolve(Response.json([{ result: 4 }, { result: 0 }, { result: 1800 }])),
      },
    );

    const result = await limiter.limit('+919876543210');
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
  });
});

describe('F0.3 · documented limits', () => {
  it('OTP request cap matches the ticket (3 per phone per hour)', () => {
    expect(RATE_LIMITS.otpRequestPerPhone.limit).toBe(3);
    expect(RATE_LIMITS.otpRequestPerPhone.windowSeconds).toBe(3600);
  });
});
