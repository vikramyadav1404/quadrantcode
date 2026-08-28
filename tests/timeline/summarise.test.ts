/**
 * F3.2 · the diff summariser.
 *
 * Criterion 5: "Diff summariser output is stable and contains zero AI calls."
 *
 * The second half is **trivially true today** — F3.4 is cut, so there is no AI
 * gateway to import. That is exactly why the check below carries a positive
 * control: a grep for something that does not exist passes without measuring
 * anything, which is the vacuous-pass failure this project has already been
 * bitten by twice.
 *
 * The first half is the real work. Stability has to survive repetition, and the
 * categories have to be checkable by a person — every classified change carries
 * the evidence that produced it, so the user can disagree with it (C4's rule,
 * applied one ticket early because F3.5 will consume these).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  describeChange,
  isUnclassified,
  summariseDiff,
} from '@/server/services/timeline/summarise';

const summarise = (before: string, after: string) => summariseDiff(before, after, 'python3');

describe('F3.2 · counting what moved', () => {
  it('counts a pure addition', () => {
    const summary = summarise('a\n', 'a\nb\n');
    expect(summary.linesAdded).toBe(1);
    expect(summary.linesRemoved).toBe(0);
    expect(summary.linesModified).toBe(0);
  });

  it('counts a pure removal', () => {
    const summary = summarise('a\nb\n', 'a\n');
    expect(summary.linesRemoved).toBe(1);
    expect(summary.linesAdded).toBe(0);
    expect(summary.linesModified).toBe(0);
  });

  it('COUNTS A REWRITE AS ONE MODIFIED LINE, not one gone and one arrived', () => {
    /*
     * The distinction the whole summary rests on. Reporting a rewrite as an
     * unrelated delete plus insert loses the pairing, and the pairing is what
     * lets it say "`<` became `<=`".
     */
    const summary = summarise('while lo < hi:\n', 'while lo <= hi:\n');

    expect(summary.linesModified).toBe(1);
    expect(summary.linesAdded).toBe(0);
    expect(summary.linesRemoved).toBe(0);

    const [change] = summary.changes;
    expect(change?.before).toBe('while lo < hi:');
    expect(change?.after).toBe('while lo <= hi:');
  });

  it('handles a change with no trailing newline', () => {
    const summary = summarise('x = 1', 'x = 2');
    expect(summary.linesModified).toBe(1);
  });
});

describe('F3.2 · classification', () => {
  it('CALLS AN OFF-BY-ONE A BOUNDARY, not a conditional', () => {
    // `while (lo <= hi)` is a comparison inside a loop. If this reported
    // "a conditional changed", the thing that actually broke would be buried.
    const summary = summarise('while lo < hi:\n', 'while lo <= hi:\n');
    expect(summary.changes[0]?.kind).toBe('boundary');
  });

  it('recognises a +1 appearing', () => {
    const summary = summarise('mid = (lo + hi) // 2\n', 'mid = (lo + hi + 1) // 2\n');
    expect(summary.changes[0]?.kind).toBe('boundary');
    expect(summary.changes[0]?.evidence.join(' ')).toMatch(/off-by-one/);
  });

  it('recognises a container', () => {
    const summary = summarise('seen = []\n', 'seen = dict()\n');
    expect(summary.changes[0]?.kind).toBe('data_structure');
    expect(summary.changes[0]?.evidence.join(' ')).toMatch(/map|list/);
  });

  it('recognises a boolean operator as a conditional', () => {
    const summary = summarise('if a:\n', 'if a and b:\n');
    expect(summary.changes[0]?.kind).toBe('conditional');
  });

  it('SAYS `other` WHEN IT CANNOT TELL, rather than guessing', () => {
    /*
     * The honest answer for a rename. F3.5 weighs these categories, and a
     * confident wrong label is worse to it than an admitted unknown.
     */
    const summary = summarise('result = compute()\n', 'answer = compute()\n');

    expect(summary.changes[0]?.kind).toBe('other');
    expect(summary.changes[0]?.evidence).toEqual([]);
    expect(isUnclassified(summary)).toBe(true);
  });

  it('every classified change carries its evidence', () => {
    // A category with no evidence is a label the user cannot argue with.
    const summary = summarise(
      'if lo < hi:\n    m = HashMap()\n',
      'if lo <= hi:\n    m = HashSet()\n',
    );

    for (const change of summary.changes) {
      if (change.kind === 'other') continue;
      expect(change.evidence.length).toBeGreaterThan(0);
    }
  });

  it('does not mistake a word containing a keyword for the keyword', () => {
    // `iffy` is not an `if`; `notable` is not a `not`.
    const summary = summarise('iffy = 1\n', 'iffy = 2\n');
    expect(summary.changes[0]?.kind).not.toBe('conditional');
  });
});

describe('F3.2 · THE OUTPUT IS STABLE', () => {
  const BEFORE = [
    'def search(nums, target):',
    '    lo, hi = 0, len(nums)',
    '    while lo < hi:',
    '        mid = (lo + hi) // 2',
    '        if nums[mid] < target:',
    '            lo = mid',
    '        else:',
    '            hi = mid',
    '    return lo',
    '',
  ].join('\n');

  const AFTER = [
    'def search(nums, target):',
    '    lo, hi = 0, len(nums) - 1',
    '    while lo <= hi:',
    '        mid = (lo + hi) // 2',
    '        if nums[mid] < target:',
    '            lo = mid + 1',
    '        else:',
    '            hi = mid - 1',
    '    return lo',
    '',
  ].join('\n');

  it('produces byte-identical output across repeated runs', () => {
    const first = JSON.stringify(summarise(BEFORE, AFTER));

    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect(JSON.stringify(summarise(BEFORE, AFTER))).toBe(first);
    }
  });

  it('finds the boundary fixes in a real binary-search correction', () => {
    const summary = summarise(BEFORE, AFTER);

    // Four lines changed, and every one of them is a bound.
    expect(summary.linesModified).toBe(4);
    expect(summary.changes.every((change) => change.kind === 'boundary')).toBe(true);
  });

  it('describes each change without claiming why it was wrong', () => {
    const summary = summarise(BEFORE, AFTER);
    const sentences = summary.changes.map(describeChange);

    for (const sentence of sentences) {
      expect(sentence).toMatch(/^(Added|Removed|Changed) a line/);
      // Never "you fixed", never "the bug was" — intent nothing observed.
      expect(sentence).not.toMatch(/\byou\b|fixed|bug|mistake|wrong/i);
    }
  });
});

describe('F3.2 · ZERO AI', () => {
  const SOURCE = readFileSync(
    join(process.cwd(), 'server', 'services', 'timeline', 'summarise.ts'),
    'utf8',
  );

  /** The check, shared with its control so both run the same code. */
  function aiReferencesIn(text: string): string[] {
    const code = text
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n')
      .filter((line) => !/^\s*(\/\/|\*)/.test(line))
      .join('\n');

    return [
      'services/ai',
      'anthropic',
      '@anthropic-ai',
      'openai',
      'generateText',
      'completion(',
    ].filter((needle) => code.toLowerCase().includes(needle.toLowerCase()));
  }

  it('the summariser imports nothing that could call a model', () => {
    expect(aiReferencesIn(SOURCE)).toEqual([]);
  });

  it('POSITIVE CONTROL · the same check catches a real AI import', () => {
    /*
     * Without this the assertion above measures nothing: F3.4 is cut, so there
     * is no AI gateway in the repository at all and a grep for one passes
     * whatever the summariser does.
     */
    const poisoned = "import { classify } from '@/server/services/ai/gateway';";
    expect(aiReferencesIn(poisoned)).toEqual(['services/ai']);
  });

  it('POSITIVE CONTROL · prose mentioning AI is not a call', () => {
    // The header says "it is not AI". A check that punished that sentence would
    // teach people to delete the sentence.
    expect(aiReferencesIn('/** This is not AI, and not anthropic either. */')).toEqual([]);
  });

  it('is a pure function — same input, same output, no clock and no network', () => {
    // Belt and braces on determinism: a summariser that read the clock would
    // still pass the repetition test inside one millisecond.
    expect(SOURCE).not.toMatch(/new Date\(|Date\.now\(|fetch\(|Math\.random\(/);
  });
});
