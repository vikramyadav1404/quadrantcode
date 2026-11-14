/**
 * The shared daily execution allowance is a setting, `EXECUTION_GLOBAL_DAILY_LIMIT`.
 *
 * Two places read it: `globalDailyLimit()` on every Submit, which falls back
 * to the default on anything unusable, and `server/env.ts`, which refuses an
 * unusable value at deploy:check. They must agree on what "usable" means, or a
 * value could pass the build and then be silently ignored — so the second half
 * of this file drives both with the same inputs.
 */
import { describe, expect, it } from 'vitest';
import { __testing } from '@/server/env';
import {
  DEFAULT_GLOBAL_DAILY_LIMIT,
  MAX_GLOBAL_DAILY_LIMIT,
  globalDailyLimit,
} from '@/server/services/execution/limits';

const production = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://user:password@db.example/quadrantcode',
  NEXT_PUBLIC_APP_URL: 'https://quadrantcode.example',
  AUTH_SECRET: 'a-random-production-secret-longer-than-32-characters',
} as const;

const limit = (value: string | undefined) =>
  globalDailyLimit({ EXECUTION_GLOBAL_DAILY_LIMIT: value });

describe('globalDailyLimit', () => {
  it('defaults to 20 when unset or blank', () => {
    expect(DEFAULT_GLOBAL_DAILY_LIMIT).toBe(20);
    expect(globalDailyLimit({})).toBe(20);
    expect(limit('')).toBe(20);
    expect(limit('   ')).toBe(20);
  });

  it('uses a whole number in range, ignoring surrounding spaces', () => {
    expect(limit('200')).toBe(200);
    expect(limit(' 75 ')).toBe(75);
    expect(limit('1')).toBe(1);
    expect(limit(String(MAX_GLOBAL_DAILY_LIMIT))).toBe(MAX_GLOBAL_DAILY_LIMIT);
  });

  it('falls back to the default on anything unusable', () => {
    for (const bad of ['0', '-5', 'abc', '1e3', '12.5', '0x10', '100001']) {
      expect(limit(bad), bad).toBe(DEFAULT_GLOBAL_DAILY_LIMIT);
    }
  });
});

describe('server/env.ts and globalDailyLimit agree', () => {
  const accepted = ['', '1', '20', ' 75 ', '100000'];
  const refused = ['0', '-5', 'abc', '1e3', '12.5', '0x10', '100001'];

  it.each(accepted)('%j is accepted at deploy:check and used as given', (value) => {
    expect(() =>
      __testing.parseServerEnv({ ...production, EXECUTION_GLOBAL_DAILY_LIMIT: value }),
    ).not.toThrow();
    const expected = value.trim() === '' ? DEFAULT_GLOBAL_DAILY_LIMIT : Number(value.trim());
    expect(limit(value)).toBe(expected);
  });

  it.each(refused)('%j is refused at deploy:check', (value) => {
    expect(() =>
      __testing.parseServerEnv({ ...production, EXECUTION_GLOBAL_DAILY_LIMIT: value }),
    ).toThrow(/EXECUTION_GLOBAL_DAILY_LIMIT/);
  });
});
