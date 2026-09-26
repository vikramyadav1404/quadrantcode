/**
 * F4.7b · the landing page may only say true things (D36).
 *
 * The owner's rule, and the ticket's: no invented numbers, no features that do
 * not exist, no testimonials or user counts. A reviewer can check copy once; a
 * test keeps checking after the next edit. So this reads the page source and
 * fails on the claims that would be false today — each with a positive control
 * proving the check can fire, because a check that cannot fail is decoration.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const PAGE = readFileSync(join(process.cwd(), 'app/page.tsx'), 'utf8');

/**
 * The page's words, not its code: string literals and JSX text, with comments
 * removed. The file's header comment NAMES the forbidden topics in order to
 * forbid them, and that sentence must not fail the test (the same distinction
 * `tests/execution/rendering.test.ts` draws).
 */
function visibleCopy(source: string): string {
  const withoutComments = source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
  const literals = [
    ...withoutComments.matchAll(/'([^'\\]|\\.)*'|"([^"\\]|\\.)*"|`[^`]*`/g),
  ].map((match) => match[0]);
  const jsxText = [...withoutComments.matchAll(/>([^<>{}]+)</g)].map((match) => match[1] ?? '');
  return [...literals, ...jsxText].join('\n');
}

/** Claims that are false today: cut features, and social proof nobody has. */
const FORBIDDEN = [
  /\bcontests?\b/i,
  // Not a bare "refer", which ordinary prose uses. Widened after the positive
  // control below caught "Refer a friend" slipping past `referr(al|ed)` alone.
  /\breferr(al|als|ed)\b|\brefer a friend\b|\binvite (a )?friends?\b/i,
  /\bcoins?\b/i,
  /\bAI\b/,
  /AI-assisted|artificial intelligence/i,
  /\bpricing\b|\bper month\b|\bfree trial\b|\bpremium plan\b|₹|\$\d/i,
  /\btestimonials?\b/i,
  /\btrusted by\b/i,
  /\b\d[\d,]*\+?\s*(users|developers|coders|learners|students)\b/i,
];

function violations(copy: string): string[] {
  return FORBIDDEN.filter((pattern) => pattern.test(copy)).map(String);
}

describe('the landing page says only true things', () => {
  const copy = visibleCopy(PAGE);

  it('reads real copy (the extractor is not returning nothing)', () => {
    expect(copy).toContain('Make every coding session count.');
    expect(copy).toContain('Demo account · example data');
  });

  it('makes none of the claims that would be false today', () => {
    expect(violations(copy)).toEqual([]);
  });

  it('POSITIVE CONTROL · each forbidden claim is caught when it appears in copy', () => {
    for (const claim of [
      "'Join weekly contests'",
      "'Earn coins for every solve'",
      "'Refer a friend'",
      "'Your AI coach'",
      "'Pricing starts at $9'",
      "'Trusted by 10,000+ developers'",
      '<p>What our testimonials say</p>',
    ]) {
      expect(violations(visibleCopy(claim)), claim).not.toEqual([]);
    }
  });

  it('NEGATIVE CONTROL · a comment naming a forbidden topic is not copy', () => {
    expect(
      violations(visibleCopy('/* no contests, coins or AI here */\nconst x = 1;')),
    ).toEqual([]);
  });

  it('labels every screenshot as a demo account with example data', () => {
    const screenshots = [...PAGE.matchAll(/\/screenshots\/[a-z-]+\.png/g)].map((m) => m[0]);
    expect(screenshots.length).toBeGreaterThanOrEqual(4);
    for (const path of new Set(screenshots)) {
      expect(existsSync(join(process.cwd(), 'public', path)), path).toBe(true);
    }
    expect(copy).toMatch(/demo account/i);
    expect(copy).toMatch(/example data/i);
  });

  it('states no rating, price or user count in its structured data', () => {
    expect(PAGE).toContain('application/ld+json');
    for (const field of [
      'aggregateRating',
      'offers',
      'ratingValue',
      'reviewCount',
      'userInteractionCount',
    ]) {
      expect(PAGE, field).not.toContain(field.replace(/^/, "'").concat("'"));
      expect(PAGE, field).not.toMatch(new RegExp(`\\b${field}\\s*:`));
    }
  });
});
