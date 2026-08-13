/**
 * F0.1 smoke test — makes the CI `test` step real, and asserts the two boot
 * guarantees the rest of the repo depends on: env validation fails loudly, and
 * feature flags default to off.
 */
import { describe, expect, it } from 'vitest';
import { __testing as publicEnv } from '@/lib/env';
import { __testing as serverEnv } from '@/server/env';
import {
  FEATURE_FLAGS,
  FeatureDisabledError,
  allFeatureFlags,
  assertFeatureEnabled,
  isFeatureEnabled,
} from '@/lib/flags';

const validEnv = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/traceloop',
  NEXT_PUBLIC_APP_URL: 'http://localhost:3000',
};

describe('server/env + lib/env', () => {
  it('parses a valid environment', () => {
    const env = serverEnv.parseServerEnv(validEnv);
    expect(env.DATABASE_URL).toBe(validEnv.DATABASE_URL);
    expect(env.NODE_ENV).toBe('test');
  });

  it('throws a readable error when a required variable is missing', () => {
    const { DATABASE_URL: _removed, ...withoutDatabase } = validEnv;

    expect(() => serverEnv.parseServerEnv(withoutDatabase)).toThrowError(
      /Invalid environment configuration[\s\S]*DATABASE_URL/,
    );
  });

  it('rejects a malformed variable rather than passing it through', () => {
    expect(() =>
      serverEnv.parseServerEnv({ ...validEnv, DATABASE_URL: 'mysql://localhost/traceloop' }),
    ).toThrowError(/postgres:\/\/ or postgresql:\/\//);
  });

  it('defaults the public app URL instead of failing a fresh checkout', () => {
    const { NEXT_PUBLIC_APP_URL: _removed, ...withoutUrl } = validEnv;
    expect(serverEnv.parseServerEnv(withoutUrl).NEXT_PUBLIC_APP_URL).toBe(
      'http://localhost:3000',
    );
  });

  it('the shared half parses without any secret present', () => {
    // lib/env.ts must stay usable in a client bundle: no DATABASE_URL needed.
    expect(publicEnv.parsePublicEnv({ NODE_ENV: 'test' }).NEXT_PUBLIC_APP_URL).toBe(
      'http://localhost:3000',
    );
  });
});

describe('lib/flags', () => {
  it('defaults every flag to false when the variable is unset', () => {
    const flags = allFeatureFlags({});
    expect(Object.values(flags).every((value) => value === false)).toBe(true);
    expect(Object.keys(flags)).toHaveLength(FEATURE_FLAGS.length);
  });

  it('enables a flag only on an exact "true" spelling', () => {
    expect(isFeatureEnabled('FEATURE_AI', { FEATURE_AI: 'true' })).toBe(true);
    expect(isFeatureEnabled('FEATURE_AI', { FEATURE_AI: '1' })).toBe(false);
    expect(isFeatureEnabled('FEATURE_AI', { FEATURE_AI: 'yes' })).toBe(false);
    expect(isFeatureEnabled('FEATURE_AI', { FEATURE_AI: '' })).toBe(false);
  });

  it('throws a typed error when a disabled feature is reached', () => {
    expect(() => assertFeatureEnabled('FEATURE_BILLING', {})).toThrowError(
      FeatureDisabledError,
    );
    expect(() =>
      assertFeatureEnabled('FEATURE_BILLING', { FEATURE_BILLING: 'true' }),
    ).not.toThrow();
  });
});
