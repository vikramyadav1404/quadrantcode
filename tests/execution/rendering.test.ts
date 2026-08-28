/**
 * F3.1 · nothing on the editor route writes markup.
 *
 * This is the cheap half of the "renders as inert text" criterion. The
 * expensive half is `e2e/execution.spec.ts`, which puts a `<script>` through
 * the real pipeline into a real browser and checks it did not run.
 *
 * This file exists because that e2e test only covers the paths it walks. A
 * `dangerouslySetInnerHTML` added to a branch the spec never renders would slip
 * past it, and the first person to find out would be a user whose program
 * printed a tag.
 *
 * The grep is over SOURCE rather than behaviour, which makes it exactly as
 * strong as its positive control — so there is one, and it fails the way the
 * real check would.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(process.cwd(), 'components', 'editor');

/** Anything that hands a string to the HTML parser. */
const MARKUP_SINKS = [
  'dangerouslySetInnerHTML',
  '.innerHTML',
  '.outerHTML',
  'insertAdjacentHTML',
  'document.write',
];

function sources(): { file: string; text: string }[] {
  return readdirSync(ROOT)
    .filter((name) => name.endsWith('.tsx') || name.endsWith('.ts'))
    .map((name) => ({ file: name, text: readFileSync(join(ROOT, name), 'utf8') }));
}

/**
 * Comments out, code in.
 *
 * The first version of this grepped whole files and failed on `RunOutput.tsx` —
 * whose header says, in prose, that there is no `dangerouslySetInnerHTML` in
 * it. A check that cannot tell a warning from a violation forces the warning to
 * be deleted, and the comment explaining WHY output is never markup is the most
 * valuable line in that file.
 *
 * Only block comments and whole-line comments are stripped. A trailing `//` on
 * a line of code is deliberately left alone: cutting from `//` to end-of-line
 * would also cut anything after a `//` inside a string, and a stripper that can
 * hide a real sink is worse than one that occasionally reads a comment.
 */
function stripComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\*)/.test(line))
    .join('\n');
}

/** The check itself, so the positive control runs the same code as the test. */
function sinksIn(text: string): string[] {
  const code = stripComments(text);
  return MARKUP_SINKS.filter((sink) => code.includes(sink));
}

describe('F3.1 · the editor route renders text, not markup', () => {
  it('reads some files, so an empty directory cannot pass this suite', () => {
    // Without this the whole file passes when `components/editor/` is renamed.
    const files = sources();
    expect(files.length).toBeGreaterThanOrEqual(3);
    expect(files.map((entry) => entry.file)).toContain('RunOutput.tsx');
  });

  for (const { file, text } of sources()) {
    it(`${file} reaches no markup sink`, () => {
      expect(sinksIn(text)).toEqual([]);
    });
  }

  it('POSITIVE CONTROL · the same check catches a sink that is there', () => {
    /*
     * If this passed, the assertions above would be measuring nothing — which
     * is the failure this project has already been bitten by twice (the vacuous
     * boundary test, the allowlisted gitleaks canary).
     */
    const poisoned = 'const bad = <pre dangerouslySetInnerHTML={{ __html: stdout }} />;';
    expect(sinksIn(poisoned)).toEqual(['dangerouslySetInnerHTML']);
  });

  it('POSITIVE CONTROL · a sink hidden behind a trailing comment is still caught', () => {
    // The stripper leaves code lines whole precisely so this cannot be evaded.
    const sneaky = 'element.innerHTML = stdout; // safe, honest, trust me';
    expect(sinksIn(sneaky)).toEqual(['.innerHTML']);
  });

  it('NEGATIVE CONTROL · prose about a sink is not a sink', () => {
    /*
     * The reason the stripper exists. `RunOutput.tsx` names
     * dangerouslySetInnerHTML in its header in order to forbid it, and a check
     * that punishes that sentence teaches people to delete the warning rather
     * than to obey it.
     */
    const documented = '/** Never dangerouslySetInnerHTML here. */\nreturn <pre>{value}</pre>;';
    expect(sinksIn(documented)).toEqual([]);
  });
});
