/**
 * C4 · which recurring mistake the v2 solve screen shows for a problem.
 */
import { describe, expect, it } from 'vitest';
import {
  RECURRING_MIN_OCCURRENCES,
  type RecurringPatternInput,
  matchRecurring,
} from '@/lib/solve-v2/recurring';

const pattern = (overrides: Partial<RecurringPatternInput>): RecurringPatternInput => ({
  category: 'off_by_one',
  topic: 'arrays-hashing',
  occurrences: 3,
  trend: 'flat',
  ...overrides,
});

describe('C4 · matchRecurring', () => {
  it('MATCHES a pattern on one of the problem topics', () => {
    expect(matchRecurring([pattern({})], ['graphs', 'arrays-hashing'])).toEqual({
      category: 'off_by_one',
      topic: 'arrays-hashing',
      occurrences: 3,
      trend: 'flat',
    });
  });

  it('is null when no pattern is on any of the problem topics', () => {
    expect(matchRecurring([pattern({ topic: 'graphs' })], ['arrays-hashing'])).toBeNull();
    expect(matchRecurring([pattern({})], [])).toBeNull();
    expect(matchRecurring([], ['arrays-hashing'])).toBeNull();
  });

  it('IGNORES A PATTERN WITH NO TOPIC: it belongs to no problem', () => {
    expect(matchRecurring([pattern({ topic: null, occurrences: 9 })], ['arrays-hashing'])).toBe(
      null,
    );
  });

  it('A SINGLE OCCURRENCE IS NOT RECURRING', () => {
    expect(RECURRING_MIN_OCCURRENCES).toBe(2);
    expect(matchRecurring([pattern({ occurrences: 1 })], ['arrays-hashing'])).toBeNull();
    // Positive control: the same row at the threshold does match.
    expect(matchRecurring([pattern({ occurrences: 2 })], ['arrays-hashing'])).not.toBeNull();
  });

  it('PICKS THE WORST match, and keeps input order on a tie', () => {
    const rows = [
      pattern({ category: 'wrong_logic', topic: 'graphs', occurrences: 7 }),
      pattern({ category: 'missed_edge_case', occurrences: 4 }),
      pattern({ category: 'off_by_one', occurrences: 5 }),
      pattern({ category: 'tle', occurrences: 5 }),
    ];
    expect(matchRecurring(rows, ['arrays-hashing'])?.category).toBe('off_by_one');
  });
});
