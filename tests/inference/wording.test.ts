/**
 * F3.3 · two criteria that are grep checks, and therefore need proving.
 *
 *   · "Zero AI calls in this module (grep for the AI gateway import returns
 *     nothing)"
 *   · "No string in the module or its UI over-claims certainty — grep for
 *     'detected', 'exactly', 'you got stuck at' returns nothing"
 *
 * **Both are trivially true today.** F3.4 is cut, so there is no AI gateway
 * anywhere in the repository to import; and nobody writes "you got stuck at" by
 * accident. A grep for either passes whatever the module does, which is exactly
 * the vacuous pass this project has been bitten by twice — the boundary rule
 * scoped to three directories, and the gitleaks canary that matched an
 * allowlisted key.
 *
 * So every check here runs against a control that SHOULD trip it.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const MODULE_DIR = join(process.cwd(), 'server', 'services', 'inference');
const LIB_DIR = join(process.cwd(), 'lib', 'inference');
const UI_FILE = join(process.cwd(), 'components', 'session', 'StuckRegions.tsx');

/** Source only. Comments explain the rules and must be free to name them. */
function code(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\*)/.test(line))
    .join('\n');
}

function filesIn(dir: string): { file: string; text: string }[] {
  return readdirSync(dir)
    .filter((name) => name.endsWith('.ts') || name.endsWith('.tsx'))
    .map((name) => ({ file: name, text: readFileSync(join(dir, name), 'utf8') }));
}

const SOURCES = [
  ...filesIn(MODULE_DIR),
  ...filesIn(LIB_DIR),
  { file: 'StuckRegions.tsx', text: readFileSync(UI_FILE, 'utf8') },
];

/** Anything that could reach a model. */
const AI_MARKERS = ['services/ai', 'anthropic', '@anthropic-ai', 'openai', 'generateText'];

function aiIn(text: string): string[] {
  const body = code(text).toLowerCase();
  return AI_MARKERS.filter((needle) => body.includes(needle.toLowerCase()));
}

/**
 * Phrases that state a guess as a fact.
 *
 * `detect` catches "detected" and "detection". `exactly` and "you got stuck at"
 * are the ticket's own examples. The rest are the ways this particular feature
 * would slip: naming a single line, or telling the user what they felt.
 */
const OVERCLAIMS = [
  /\bdetect(ed|s|ion)?\b/i,
  /\bexactly\b/i,
  /you got stuck at/i,
  /\byou were stuck\b/i,
  /\bwe found where\b/i,
  /\bproves?\b/i,
];

function overclaimsIn(text: string): string[] {
  const body = code(text);
  return OVERCLAIMS.filter((pattern) => pattern.test(body)).map(String);
}

describe('F3.3 · zero AI', () => {
  it('reads the files it claims to check', () => {
    // Without this, a renamed directory makes every assertion below vacuous.
    expect(SOURCES.length).toBeGreaterThanOrEqual(6);
    expect(SOURCES.map((entry) => entry.file)).toContain('signals.ts');
    expect(SOURCES.map((entry) => entry.file)).toContain('StuckRegions.tsx');
  });

  for (const { file, text } of SOURCES) {
    it(`${file} imports nothing that could call a model`, () => {
      expect(aiIn(text)).toEqual([]);
    });
  }

  it('POSITIVE CONTROL · the check catches a real AI import', () => {
    expect(aiIn("import { classify } from '@/server/services/ai/gateway';")).toEqual([
      'services/ai',
    ]);
  });

  it('the signals are pure — no clock, no randomness, no network', () => {
    /*
     * "No AI" is not the same as "deterministic", and the ticket needs both.
     * A module that read the clock would pass the import grep and still produce
     * a different answer on a second run.
     */
    const pure = SOURCES.filter((entry) =>
      ['signals.ts', 'rank.ts', 'types.ts'].includes(entry.file),
    );

    expect(pure.length).toBe(3);
    for (const { file, text } of pure) {
      expect(code(text), file).not.toMatch(/new Date\(|Date\.now\(|Math\.random\(|fetch\(/);
    }
  });
});

describe('F3.3 · nothing over-claims certainty', () => {
  for (const { file, text } of SOURCES) {
    it(`${file} states no guess as a fact`, () => {
      expect(overclaimsIn(text)).toEqual([]);
    });
  }

  it('POSITIVE CONTROL · the check catches each banned phrase', () => {
    /*
     * Six patterns, each proved to fire. A regex with a typo in it matches
     * nothing and passes forever, which is how a wording rule quietly stops
     * being enforced.
     */
    expect(overclaimsIn('const label = "we detected the problem";').length).toBe(1);
    expect(overclaimsIn('const label = "exactly here";').length).toBe(1);
    expect(overclaimsIn('const label = "you got stuck at line 18";').length).toBe(1);
    expect(overclaimsIn('const label = "you were stuck";').length).toBe(1);
    expect(overclaimsIn('const label = "we found where it went wrong";').length).toBe(1);
    expect(overclaimsIn('const label = "this proves it";').length).toBe(1);
  });

  it('POSITIVE CONTROL · prose in a comment is not an over-claim', () => {
    // The headers explain why nothing may say "detected". A check that punished
    // that sentence would teach people to delete the explanation.
    expect(overclaimsIn('/** Never say detected here. */\nconst x = 1;')).toEqual([]);
  });

  it('the user-facing labels all hedge', () => {
    const labels = readFileSync(join(LIB_DIR, 'confidence.ts'), 'utf8');

    // Every inferred label is a hedge; only the user's own marker is stated flat.
    expect(labels).toMatch(/Likely a stuck point/);
    expect(labels).toMatch(/Possibly a stuck point/);
    expect(labels).toMatch(/Might be a stuck point/);
    expect(labels).toMatch(/You marked this/);
  });
});
