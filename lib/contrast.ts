/**
 * WCAG 2.1 relative luminance and contrast ratio.
 *
 * F0.4 requires contrast to be MEASURED, not assumed: "compute and print the
 * actual contrast ratio for every token pair used for text… if a pair fails,
 * change the token, do not waive it." This module is the measurement, used by
 * both `scripts/contrast.ts` (prints the table) and the test suite (fails CI).
 *
 * Formulas: https://www.w3.org/TR/WCAG21/#dfn-relative-luminance
 */

export type Rgb = { r: number; g: number; b: number };

/** Accepts #rgb and #rrggbb. Throws on anything else — a silent 0 would hide a typo. */
export function parseHex(hex: string): Rgb {
  const value = hex.trim().replace(/^#/, '');

  const expanded =
    value.length === 3
      ? value
          .split('')
          .map((char) => char + char)
          .join('')
      : value;

  if (!/^[0-9a-fA-F]{6}$/.test(expanded)) {
    throw new Error(`Not a hex colour: ${hex}`);
  }

  return {
    r: Number.parseInt(expanded.slice(0, 2), 16),
    g: Number.parseInt(expanded.slice(2, 4), 16),
    b: Number.parseInt(expanded.slice(4, 6), 16),
  };
}

/** sRGB channel → linear. */
function linearise(channel: number): number {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance(colour: Rgb): number {
  return (
    0.2126 * linearise(colour.r) + 0.7152 * linearise(colour.g) + 0.0722 * linearise(colour.b)
  );
}

/** Contrast ratio, 1:1 (identical) to 21:1 (black on white). */
export function contrastRatio(foreground: string, background: string): number {
  const a = relativeLuminance(parseHex(foreground));
  const b = relativeLuminance(parseHex(background));
  const [lighter, darker] = a > b ? [a, b] : [b, a];
  return (lighter + 0.05) / (darker + 0.05);
}

/** Rounded to 2dp for display, floored so a printed 4.50 is never actually 4.495. */
export function formatRatio(ratio: number): string {
  return (Math.floor(ratio * 100) / 100).toFixed(2);
}

export const WCAG_AA_BODY = 4.5;
export const WCAG_AA_LARGE = 3;
/** Non-text contrast: borders, focus rings, icons (WCAG 1.4.11). */
export const WCAG_AA_NON_TEXT = 3;
