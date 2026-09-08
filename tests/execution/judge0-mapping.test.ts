/**
 * F3.1 · the one part of the Judge0 client that can be checked without Judge0.
 *
 * There is no instance to run against, so `Judge0Provider` as a whole is
 * UNVERIFIED and recorded as blocked. The status mapping is not: it is a pure
 * function over documented ids, and it is the piece most likely to be wrong in
 * a way nobody notices — a mis-mapped status turns a compile error into
 * "accepted".
 */
import { describe, expect, it } from 'vitest';
import { selectJudge0Language, verdictForStatus } from '@/server/services/execution';
import { EXECUTION_LANGUAGES } from '@/lib/execution/languages';

describe('F3.1 · Judge0 status → our verdict', () => {
  it('maps the outcomes that mean something specific', () => {
    expect(verdictForStatus(3)).toBe('accepted');
    expect(verdictForStatus(4)).toBe('wrong_answer');
    expect(verdictForStatus(5)).toBe('tle');
    expect(verdictForStatus(6)).toBe('compile_error');
  });

  it('maps every runtime-error signal to one verdict', () => {
    // 7–12 are SIGSEGV, SIGXFSZ, SIGFPE, SIGABRT, NZEC and "other". They are
    // one thing to a user: the program crashed.
    for (const statusId of [7, 8, 9, 10, 11, 12]) {
      expect(verdictForStatus(statusId), `status ${statusId}`).toBe('runtime_error');
    }
  });

  it('TREATS A STILL-RUNNING STATUS AS AN INTERNAL FAILURE', () => {
    /*
     * 1 and 2 mean "in queue" and "processing", and they must never reach the
     * mapping — the caller polls until the submission is finished. Arriving
     * here with one means the poll gave up, which is a failure of ours and not
     * a statement about the code.
     */
    expect(verdictForStatus(1)).toBe('internal_error');
    expect(verdictForStatus(2)).toBe('internal_error');
  });

  it('maps anything unrecognised to an internal failure, not to a guess', () => {
    // A Judge0 upgrade that adds a status must not silently become "accepted".
    expect(verdictForStatus(13)).toBe('internal_error');
    expect(verdictForStatus(14)).toBe('internal_error');
    expect(verdictForStatus(99)).toBe('internal_error');
    expect(verdictForStatus(0)).toBe('internal_error');
  });

  it('discovers every editor language without assuming numeric ids', () => {
    const exposed = [
      { id: 110, name: 'C (GCC 12.2.0)' },
      { id: 111, name: 'C++ (GCC 12.2.0)' },
      { id: 112, name: 'Java (OpenJDK 21.0.2)' },
      { id: 113, name: 'Python (3.12.1)' },
      { id: 114, name: 'JavaScript (Node.js 22.1.0)' },
    ];

    for (const language of EXECUTION_LANGUAGES) {
      expect(selectJudge0Language(exposed, language), language).not.toBeNull();
    }
  });
});
