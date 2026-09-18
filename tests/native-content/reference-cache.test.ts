/**
 * Controls for the reference-validation cache key.
 *
 * Written before the cache was wired into `validate-native-references.ts`.
 *
 * The failure mode here is specific and quiet: **a cache that always hits is
 * indistinguishable from a validator that checks nothing.** A suite that only
 * asserted "identical input gives the same key" would stay green if the key
 * ignored the reference solution entirely. So most of these assert a MISS —
 * that changing one component changes the key — and only one asserts a hit.
 *
 * Each component below exists because something can change underneath a cached
 * result without the record itself changing:
 *
 *   source        the reference solution, or the shared wrapper it is spliced into
 *   testCases     an input or an expected output was edited
 *   toolchain     gcc, javac, python or node was upgraded
 *   platform      a cache built on Windows reused on Linux
 *   harnessHash   wrapUserSource or outputsMatch changed — neither is per-record,
 *                 so nothing else in the key would notice
 */
import { describe, expect, it } from 'vitest';
import { referenceCacheKey, type ReferenceCacheKeyInput } from '@/scripts/reference-cache';

function baseline(): ReferenceCacheKeyInput {
  return {
    language: 'c11',
    source: 'long long solve(const long long *v, int n) { return n; }',
    testCases: [
      { input: '1 2 3', expectedOutput: '3' },
      { input: '', expectedOutput: '0' },
    ],
    toolchain: 'gcc 14.2.0',
    platform: 'win32-x64',
    harnessHash: 'abc123',
  };
}

describe('referenceCacheKey', () => {
  it('is stable for identical input, or the cache never hits', () => {
    expect(referenceCacheKey(baseline())).toBe(referenceCacheKey(baseline()));
  });

  it('changes when the reference solution changes', () => {
    const changed = { ...baseline(), source: baseline().source + ' ' };
    expect(referenceCacheKey(changed)).not.toBe(referenceCacheKey(baseline()));
  });

  it('changes when a test input changes', () => {
    const changed = {
      ...baseline(),
      testCases: [{ input: '1 2 4', expectedOutput: '3' }, baseline().testCases[1]!],
    };
    expect(referenceCacheKey(changed)).not.toBe(referenceCacheKey(baseline()));
  });

  it('changes when an expected output changes', () => {
    const changed = {
      ...baseline(),
      testCases: [{ input: '1 2 3', expectedOutput: '999' }, baseline().testCases[1]!],
    };
    expect(referenceCacheKey(changed)).not.toBe(referenceCacheKey(baseline()));
  });

  it('changes when a test case is added', () => {
    const changed = {
      ...baseline(),
      testCases: [...baseline().testCases, { input: '7', expectedOutput: '1' }],
    };
    expect(referenceCacheKey(changed)).not.toBe(referenceCacheKey(baseline()));
  });

  it('changes when test cases are reordered', () => {
    // Over-invalidation on purpose. The outcome of a reordered suite is the
    // same, but proving that is harder than re-running it.
    const changed = { ...baseline(), testCases: [...baseline().testCases].reverse() };
    expect(referenceCacheKey(changed)).not.toBe(referenceCacheKey(baseline()));
  });

  it('changes when the toolchain version changes', () => {
    const changed = { ...baseline(), toolchain: 'gcc 15.0.0' };
    expect(referenceCacheKey(changed)).not.toBe(referenceCacheKey(baseline()));
  });

  it('changes when the platform changes', () => {
    const changed = { ...baseline(), platform: 'linux-x64' };
    expect(referenceCacheKey(changed)).not.toBe(referenceCacheKey(baseline()));
  });

  it('changes when the execution harness changes', () => {
    const changed = { ...baseline(), harnessHash: 'def456' };
    expect(referenceCacheKey(changed)).not.toBe(referenceCacheKey(baseline()));
  });

  it('changes when the language changes', () => {
    const changed = { ...baseline(), language: 'cpp17' };
    expect(referenceCacheKey(changed)).not.toBe(referenceCacheKey(baseline()));
  });

  it('does not let a field boundary be forged', () => {
    /*
     * Concatenating fields with a separator invites collisions: if the key were
     * `language + ':' + source`, then ('c11:x', 'y') and ('c11', 'x:y') would
     * hash the same. Structured serialisation is what prevents that, and this
     * asserts it rather than trusting it.
     */
    const left = { ...baseline(), language: 'c11', source: 'x' };
    const right = { ...baseline(), language: 'c11:x', source: '' };
    expect(referenceCacheKey(left)).not.toBe(referenceCacheKey(right));
  });
});
