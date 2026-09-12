/**
 * F1.6 · the analytics layer never calls itself AI, and never claims to predict.
 *
 * > **HARD RULE** Do NOT label this AI or a prediction anywhere in code, UI, or
 * > comments. It is a deterministic score.
 *
 * The rule is not cosmetic. C4 forbids the product from over-claiming certainty,
 * and a weak-topic panel is exactly where that temptation lives: "we predict you
 * will struggle with graphs" is a sentence nobody can check, while "not practised
 * in 18 days, and 4 of 10 attempts ended stuck" is one the user can argue with.
 * Once the first phrasing ships, the second stops being the standard.
 *
 * So this scans the raw source — service, components, page and docs — the way
 * the boundary and design-token guards do. It reads text, not behaviour, and it
 * cannot tell a discussion of the rule from a breach of it; that false-positive
 * surface is the price of a guard that greps, and F1.3 already decided such a
 * guard is worth more than one people learn to edit around.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

/** Everything F1.6 owns. Directories that do not exist yet are simply skipped. */
const SCANNED_PATHS = [
  'server/services/analytics',
  'components/analytics',
  'lib/analytics',
  'app/(app)/analytics',
  'app/(app)/dashboard',
  'docs/scoring.md',
];

const SCANNED_EXTENSIONS = new Set(['.ts', '.tsx', '.md']);

/**
 * The words that would breach the rule.
 *
 * `\bAI\b` is case-sensitive on purpose: lowercase "ai" appears inside ordinary
 * words (available, again, explain) and matching those would produce a guard
 * nobody could keep green. The capitalised acronym is the thing being banned.
 */
const FORBIDDEN: { pattern: RegExp; why: string }[] = [
  { pattern: /\bAI\b/, why: 'calls the score AI' },
  { pattern: /artificial intelligence/i, why: 'calls the score artificial intelligence' },
  { pattern: /machine learning/i, why: 'calls the score machine learning' },
  { pattern: /\bpredict(s|ed|ing|ion|ions|ive)?\b/i, why: 'claims to predict' },
  { pattern: /\bforecast(s|ed|ing)?\b/i, why: 'claims to forecast' },
];

function filesUnder(path: string): string[] {
  if (!existsSync(path)) return [];
  if (statSync(path).isFile()) return SCANNED_EXTENSIONS.has(extname(path)) ? [path] : [];

  return readdirSync(path).flatMap((entry) => filesUnder(join(path, entry)));
}

const files = SCANNED_PATHS.flatMap(filesUnder);

describe('F1.6 · the wording rule', () => {
  it('SCANS SOMETHING — the guard is not passing over an empty set', () => {
    /*
     * The positive control, and the one that matters most here. Every assertion
     * below is "this word is absent", which passes trivially if no file was
     * read at all — the same vacuous-pass shape as the 0-byte gitleaks run and
     * the boundary rule that was scoped to three directories.
     */
    expect(files.length).toBeGreaterThan(3);
    expect(files.some((file) => file.includes('scoring'))).toBe(true);
  });

  it('THE SCAN CAN ACTUALLY FAIL — it finds a word that IS there', () => {
    // Proving the reader works before trusting what it did not find.
    const corpus = files.map((file) => readFileSync(file, 'utf8')).join('\n');
    expect(/weak[- ]topic/i.test(corpus)).toBe(true);
  });

  it.each(FORBIDDEN)('never $why', ({ pattern }) => {
    const offenders = files
      .map((file) => ({ file, contents: readFileSync(file, 'utf8') }))
      .flatMap(({ file, contents }) =>
        contents
          .split('\n')
          .map((line, index) => ({ file, line: index + 1, text: line }))
          .filter((row) => pattern.test(row.text)),
      )
      .map((row) => `${row.file}:${row.line} — ${row.text.trim()}`);

    expect(offenders).toEqual([]);
  });

  it('says what it IS, not only what it is not', () => {
    /*
     * A module could pass every rule above by describing nothing at all. The
     * ticket asks for an explainable deterministic score, so the words that
     * make that claim have to be present somewhere.
     */
    const corpus = files.map((file) => readFileSync(file, 'utf8')).join('\n');

    expect(/deterministic/i.test(corpus)).toBe(true);
    expect(/arithmetic/i.test(corpus)).toBe(true);
  });
});
