import { describe, expect, it } from 'vitest';
import { normalizeFormNewlines } from '@/server/services/admin/form-text';

describe('normalizeFormNewlines', () => {
  it('turns the CRLF a browser submits back into the LF the batch files hold', () => {
    const submitted = {
      problemId: '8dc305cc-3070-4781-8585-2b3830c04665',
      statement: 'First paragraph.\r\n\r\nSecond paragraph.',
      constraints: '1 <= n\r\n0 <= x',
    };

    expect(normalizeFormNewlines(submitted)).toEqual({
      problemId: '8dc305cc-3070-4781-8585-2b3830c04665',
      statement: 'First paragraph.\n\nSecond paragraph.',
      constraints: '1 <= n\n0 <= x',
    });
  });

  it('also handles a lone CR, and leaves LF text unchanged', () => {
    expect(normalizeFormNewlines({ a: 'one\rtwo', b: 'three\nfour' })).toEqual({
      a: 'one\ntwo',
      b: 'three\nfour',
    });
  });

  it('passes non-string values and non-objects through untouched', () => {
    expect(normalizeFormNewlines({ isPerformance: true, count: 3 })).toEqual({
      isPerformance: true,
      count: 3,
    });
    expect(normalizeFormNewlines(null)).toBeNull();
    expect(normalizeFormNewlines('a\r\nb')).toBe('a\r\nb');
  });
});
