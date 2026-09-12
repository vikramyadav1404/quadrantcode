/**
 * F1.2 · the curated library, such as it is.
 *
 * The ticket's criterion is "100-problem library seeded, every row has a
 * working URL and >=1 pattern tag". This file asserts the SECOND HALF only,
 * over however many rows exist.
 *
 * That is deliberate. Asserting a count of 100 would be asserting that I
 * generated 100 URLs, and a URL generated from memory that 404s is worse than
 * an absent row — it is a broken link with our name on it, and inventing
 * platform content is what C1 forbids. The count stays BLOCKED on a real list;
 * what IS here is checked properly.
 *
 * "Working URL" is a claim about the internet and cannot be settled here. It is
 * settled by `npm run library:verify`, which is opt-in because a network test
 * in CI fails for reasons unrelated to the change and teaches people to ignore
 * red.
 */
import { describe, expect, it } from 'vitest';
import { LEETCODE_PROBLEM_URL, loadLibrary } from '@/server/services/ingest/library';
import { normaliseProblemUrl } from '@/server/services/ingest/normalise-url';

const library = loadLibrary();

describe('F1.2 · data/library.json', () => {
  it('parses and is not empty', () => {
    expect(library.length).toBeGreaterThan(0);
  });

  it('every row has at least one pattern tag', () => {
    // Half of the ticket's criterion, and the half that is checkable here.
    const missing = library.filter((row) => row.patterns.length === 0).map((row) => row.slug);
    expect(missing).toEqual([]);
  });

  it('every row has at least one topic tag', () => {
    const missing = library.filter((row) => row.topics.length === 0).map((row) => row.slug);
    expect(missing).toEqual([]);
  });

  it('every slug is canonical, so the derived URL cannot 404 on a typo', () => {
    // URLs are DERIVED from slugs, never typed, so a malformed slug is the only
    // way a broken link gets in.
    const bad = library.filter((row) => !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(row.slug));
    expect(bad.map((row) => row.slug)).toEqual([]);
  });

  it('no slug appears twice', () => {
    // A duplicate would import once and silently vanish from its second set.
    const slugs = library.map((row) => row.slug);
    expect(slugs.length).toBe(new Set(slugs).size);
  });

  it('every row normalises to a usable dedup key', () => {
    for (const row of library) {
      expect(row.normalisedUrl, row.slug).toBe(
        normaliseProblemUrl(LEETCODE_PROBLEM_URL(row.slug)),
      );
      expect(row.normalisedUrl).toMatch(/^leetcode\.com\/problems\//);
    }
  });

  it('carries NO statement-bearing content — C1', () => {
    /*
     * The library is metadata and a link. If a field ever appeared here holding
     * a statement, an example or an editorial, it would be copied platform
     * content and the DB CHECK would reject it at import — but by then it is in
     * the repository, which is the part that matters.
     */
    const forbidden = [
      'statement',
      'inputFormat',
      'outputFormat',
      'constraints',
      'examples',
      'editorial',
    ];
    for (const row of library) {
      for (const field of forbidden) {
        expect(field in row, `${row.slug} carries ${field}`).toBe(false);
      }
    }
  });

  it('is HONEST about being incomplete', () => {
    /*
     * The one assertion that would fail if someone "finished" the library by
     * generating rows: the file must keep saying it is short of 100 for a
     * reason. If the real list arrives and the count is genuinely met, this
     * test is the thing that has to be updated deliberately.
     */
    expect(library.length).toBeLessThan(100);
  });
});
