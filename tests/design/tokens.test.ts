/**
 * F0.4 acceptance criteria that can be checked mechanically:
 *
 *   - every documented contrast ratio actually holds (no waivers)
 *   - styles/tokens.css and lib/design-tokens.ts never diverge
 *   - no component contains a literal colour
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { WCAG_AA_BODY, WCAG_AA_NON_TEXT, contrastRatio, parseHex } from '@/lib/contrast';
import {
  NON_TEXT_PAIRS,
  TEXT_PAIRS,
  TOKENS,
  type ThemeName,
  type TokenName,
} from '@/lib/design-tokens';

const THEMES: ThemeName[] = ['dark', 'light'];

describe('F0.4 · contrast is measured, not assumed', () => {
  for (const theme of THEMES) {
    describe(theme, () => {
      it.each(TEXT_PAIRS)(
        '$foreground on $background ($usage) meets 4.5:1',
        ({ foreground, background }) => {
          const ratio = contrastRatio(TOKENS[theme][foreground], TOKENS[theme][background]);
          expect(ratio).toBeGreaterThanOrEqual(WCAG_AA_BODY);
        },
      );

      it.each(NON_TEXT_PAIRS)(
        '$foreground on $background ($usage) meets 3:1',
        ({ foreground, background }) => {
          const ratio = contrastRatio(TOKENS[theme][foreground], TOKENS[theme][background]);
          expect(ratio).toBeGreaterThanOrEqual(WCAG_AA_NON_TEXT);
        },
      );
    });
  }

  it('covers every token that renders text', () => {
    const covered = new Set(TEXT_PAIRS.flatMap((p) => [p.foreground, p.background]));
    const textTokens: TokenName[] = [
      'text-primary',
      'text-muted',
      'accent',
      'accent-foreground',
      'success',
      'warning',
      'danger',
    ];
    for (const token of textTokens) expect(covered).toContain(token);
  });
});

describe('F0.4 · contrast maths', () => {
  it('matches known reference values', () => {
    // Black on white is the canonical 21:1.
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrastRatio('#ffffff', '#ffffff')).toBeCloseTo(1, 5);
    // #767676 on white is the textbook "just passes 4.5:1" grey.
    expect(contrastRatio('#767676', '#ffffff')).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio('#777777', '#ffffff')).toBeLessThan(4.6);
  });

  it('is symmetric', () => {
    expect(contrastRatio('#123456', '#abcdef')).toBeCloseTo(
      contrastRatio('#abcdef', '#123456'),
      10,
    );
  });

  it('expands 3-digit hex and rejects nonsense', () => {
    expect(parseHex('#fff')).toEqual({ r: 255, g: 255, b: 255 });
    expect(() => parseHex('#gggggg')).toThrow(/Not a hex colour/);
    expect(() => parseHex('rebeccapurple')).toThrow();
  });
});

describe('F0.4 · tokens.css and design-tokens.ts agree', () => {
  const css = readFileSync('styles/tokens.css', 'utf8');

  /** Reads the variable block for a theme selector out of the CSS. */
  function declaredValues(selector: string): Record<string, string> {
    const start = css.indexOf(selector);
    expect(start).toBeGreaterThan(-1);
    const block = css.slice(css.indexOf('{', start) + 1, css.indexOf('}', start));

    const values: Record<string, string> = {};
    for (const line of block.split('\n')) {
      const match = /^\s*--([a-z-]+):\s*(#[0-9a-fA-F]{3,8});/.exec(line);
      if (match) values[match[1]!] = match[2]!.toLowerCase();
    }
    return values;
  }

  it.each(THEMES)('%s theme values match', (theme) => {
    const selector = theme === 'dark' ? ':root {' : "[data-theme='light'] {";
    const declared = declaredValues(selector);

    for (const [token, value] of Object.entries(TOKENS[theme])) {
      expect(declared[token], `--${token} in ${selector}`).toBe(value.toLowerCase());
    }
  });

  it('documents every measured ratio in a comment', () => {
    // The header table must mention each pair, so the numbers stay next to the
    // colours rather than living only in a script's output.
    for (const pair of [...TEXT_PAIRS, ...NON_TEXT_PAIRS]) {
      expect(css).toContain(pair.foreground);
      expect(css).toContain(pair.background);
    }
  });
});

describe('F0.4 · no literal colours in components', () => {
  function sourceFiles(root: string): string[] {
    if (!readdirSync('.').includes(root.split('/')[0]!)) return [];

    const out: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
          walk(full);
        } else if (['.ts', '.tsx', '.css'].includes(extname(entry))) {
          out.push(full);
        }
      }
    };
    walk(root);
    return out;
  }

  const files = [...sourceFiles('components'), ...sourceFiles('app')].filter(
    // globals.css legitimately holds the token definitions it imports.
    (file) => !file.endsWith('globals.css'),
  );

  const HEX = /#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?\b/g;
  const FUNCTIONAL = /\b(?:rgba?|hsla?|oklch|color-mix)\s*\(/g;

  it('finds no hex literal', () => {
    const offenders: string[] = [];

    for (const file of files) {
      const contents = readFileSync(file, 'utf8');
      for (const line of contents.split('\n')) {
        // Fragment identifiers and CSS ids are not colours.
        const stripped = line.replace(/href=["'][^"']*["']/g, '').replace(/#[a-z-]+\s*\{/g, '');
        if (HEX.test(stripped)) offenders.push(`${file}: ${line.trim()}`);
        HEX.lastIndex = 0;
      }
    }

    expect(offenders).toEqual([]);
  });

  it('finds no rgb()/hsl() literal', () => {
    const offenders: string[] = [];

    for (const file of files) {
      const contents = readFileSync(file, 'utf8');
      if (FUNCTIONAL.test(contents)) offenders.push(file);
      FUNCTIONAL.lastIndex = 0;
    }

    expect(offenders).toEqual([]);
  });
});
