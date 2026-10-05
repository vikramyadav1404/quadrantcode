/**
 * C2 · the middleware rule that serves v2 at the v1 URL, and only when on.
 */
import { describe, expect, it } from 'vitest';
import { isFeatureEnabled } from '@/lib/flags';
import { solveV2Rewrite } from '@/lib/solve-v2/rewrite';

describe('C2 · solveV2Rewrite', () => {
  it('FLAG OFF: rewrites nothing at all', () => {
    for (const path of ['/problems/two-sum/solve', '/problems/two-sum', '/dashboard', '/']) {
      expect(solveV2Rewrite(path, false)).toBeNull();
    }
  });

  it('FLAG ON: /problems/[slug]/solve goes to the internal v2 route', () => {
    expect(solveV2Rewrite('/problems/two-sum/solve', true)).toBe('/problems/two-sum/solve/v2');
    expect(solveV2Rewrite('/problems/two-sum/solve/', true)).toBe('/problems/two-sum/solve/v2');
  });

  it('FLAG ON: every other path is left alone, including v2 itself', () => {
    for (const path of [
      '/problems/two-sum',
      '/problems/two-sum/solve/v2',
      '/problems/solve',
      '/problems/a/b/solve',
      '/dashboard',
    ]) {
      expect(solveV2Rewrite(path, true), path).toBeNull();
    }
  });
});

describe('C2 · the flag as the middleware reads it', () => {
  it('reads the value at call time from the env object, so a runtime change is seen', () => {
    // Middleware calls isFeatureEnabled('FEATURE_SOLVE_V2') per request. A
    // dynamic key on the env object cannot be inlined at build time.
    expect(isFeatureEnabled('FEATURE_SOLVE_V2', {})).toBe(false);
    expect(isFeatureEnabled('FEATURE_SOLVE_V2', { FEATURE_SOLVE_V2: 'true' })).toBe(true);
    expect(isFeatureEnabled('FEATURE_SOLVE_V2', { FEATURE_SOLVE_V2: '1' })).toBe(false);
  });
});
