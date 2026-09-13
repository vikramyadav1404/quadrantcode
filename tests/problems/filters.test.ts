/**
 * F1.1 · the catalog filters, given what an HTML form actually sends.
 *
 * `/problems` is a plain `<form method="get">`. A GET form submits every named
 * field, empty ones included, so the unfiltered case arrives as `?search=` and
 * `?difficulty=` — the strings, not absence. `.optional()` accepts `undefined`
 * and rejects `''`, and `parseFilters` uses `.parse()`, so the most ordinary
 * interaction on the page — clicking Apply with nothing selected — threw a
 * ZodError.
 *
 * It never surfaced as a 500. The throw happens after Next has begun streaming,
 * so the response is committed 200 and the root error boundary renders into it.
 * From the outside: a healthy status code and a broken panel.
 *
 * Nothing caught it. The suites around this one call `parseFilters` with clean
 * values only (`{ difficulty: 'hard' }`, `{ difficulty: 'medium' }`), and no
 * browser test submits the form. This file covers the input the UI really
 * produces.
 */
import { describe, expect, it } from 'vitest';
import { parseFilters } from '@/server/services/problems';

describe('F1.1 · filters accept what the form sends', () => {
  it('BLANK APPLY — an empty search and difficulty parse as absent', () => {
    // Exactly `?search=&difficulty=`: the whole bug, in one assertion.
    const filters = parseFilters({ search: '', difficulty: '', limit: 25 });

    expect(filters.search).toBeUndefined();
    expect(filters.difficulty).toBeUndefined();
  });

  it('every optional filter treats an empty string as absent', () => {
    const filters = parseFilters({
      difficulty: '',
      topic: '',
      pattern: '',
      platform: '',
      userStatus: '',
      search: '',
      cursor: '',
      limit: 25,
    });

    for (const key of [
      'difficulty',
      'topic',
      'pattern',
      'platform',
      'userStatus',
      'search',
      'cursor',
    ] as const) {
      expect(filters[key], key).toBeUndefined();
    }
  });

  it('a difficulty alone still works, with the search box left empty', () => {
    // The combination a user reaches by picking Easy and clicking Apply.
    const filters = parseFilters({ search: '', difficulty: 'easy', limit: 25 });

    expect(filters.difficulty).toBe('easy');
    expect(filters.search).toBeUndefined();
  });

  it('a search alone still works, with difficulty left on Any', () => {
    const filters = parseFilters({ search: 'binary', difficulty: '', limit: 25 });

    expect(filters.search).toBe('binary');
    expect(filters.difficulty).toBeUndefined();
  });

  it('POSITIVE CONTROL · real values are still carried through', () => {
    /*
     * Without this, every assertion above would pass against a schema that
     * dropped these fields entirely.
     */
    const filters = parseFilters({ difficulty: 'hard', search: 'trees', limit: 25 });

    expect(filters.difficulty).toBe('hard');
    expect(filters.search).toBe('trees');
  });

  it('POSITIVE CONTROL · genuinely bad input is STILL rejected', () => {
    /*
     * The fix normalises `''` and nothing else. A wrong enum member or an
     * oversized search is real bad input and must keep throwing — loosening
     * that to make the form work would have been the wrong repair.
     */
    expect(() => parseFilters({ difficulty: 'impossible', limit: 25 })).toThrow();
    expect(() => parseFilters({ userStatus: 'nonsense', limit: 25 })).toThrow();
    expect(() => parseFilters({ search: 'x'.repeat(201), limit: 25 })).toThrow();
    expect(() => parseFilters({ cursor: 'x'.repeat(513), limit: 25 })).toThrow();
  });

  it('whitespace-only search is absent, not a search for spaces', () => {
    // `.trim()` runs inside the schema, so '   ' collapses and then fails
    // min(1) — it must land as absent rather than throwing.
    expect(parseFilters({ search: '   ', limit: 25 }).search).toBeUndefined();
  });
});
