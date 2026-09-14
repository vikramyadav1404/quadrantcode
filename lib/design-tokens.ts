/**
 * The token values, in TypeScript, so they can be MEASURED.
 *
 * `styles/tokens.css` is the runtime source of truth; this file mirrors it and
 * `tests/design/tokens.test.ts` asserts the two never diverge. Duplicating the
 * values is the price of being able to compute contrast ratios in CI — a CSS
 * file alone cannot fail a build.
 */

export type ThemeName = 'dark' | 'light';

export type TokenName =
  | 'background'
  | 'surface'
  | 'surface-raised'
  | 'border'
  | 'text-primary'
  | 'text-muted'
  | 'accent'
  | 'accent-foreground'
  | 'success'
  | 'warning'
  | 'danger'
  | 'focus-ring';

export const TOKENS: Record<ThemeName, Record<TokenName, string>> = {
  dark: {
    background: '#0b0d10',
    surface: '#14171c',
    'surface-raised': '#1c2027',
    /*
     * Lightened from #5f656f, which measured 2.78:1 against `surface-raised`
     * and so failed the 3:1 non-text minimum. Nothing new caused that — chips,
     * the confirm dialog and the stuck dialog have all drawn this border on
     * that surface since F0.4. The pairing simply was not declared here, so
     * `npm run contrast` never looked at it.
     */
    border: '#6a707b',
    'text-primary': '#e9edf3',
    'text-muted': '#a7b0be',
    accent: '#7fb3ff',
    'accent-foreground': '#06101f',
    success: '#5ed6a4',
    warning: '#f0c36d',
    danger: '#ff8f8f',
    'focus-ring': '#7fb3ff',
  },
  light: {
    background: '#ffffff',
    surface: '#f6f7f9',
    'surface-raised': '#ffffff',
    border: '#878d97',
    'text-primary': '#14171c',
    'text-muted': '#535d6b',
    accent: '#1350b8',
    'accent-foreground': '#ffffff',
    success: '#0a6b4a',
    warning: '#6b4800',
    danger: '#b3261e',
    'focus-ring': '#1350b8',
  },
};

/**
 * Every foreground/background pair that actually renders TEXT in the app.
 * If a component introduces a new pairing it must be added here, or its
 * contrast is unmeasured.
 */
export const TEXT_PAIRS: Array<{
  foreground: TokenName;
  background: TokenName;
  usage: string;
  /** Large text (>=18.66px bold or >=24px) may use the 3:1 threshold. */
  large?: boolean;
}> = [
  { foreground: 'text-primary', background: 'background', usage: 'body copy on the page' },
  { foreground: 'text-primary', background: 'surface', usage: 'body copy on a card' },
  { foreground: 'text-primary', background: 'surface-raised', usage: 'body copy in a dialog' },
  { foreground: 'text-muted', background: 'background', usage: 'secondary copy on the page' },
  { foreground: 'text-muted', background: 'surface', usage: 'secondary copy on a card' },
  { foreground: 'text-muted', background: 'surface-raised', usage: 'help text in a dialog' },
  { foreground: 'accent', background: 'background', usage: 'links and active nav' },
  { foreground: 'accent', background: 'surface', usage: 'links inside a card' },
  { foreground: 'accent-foreground', background: 'accent', usage: 'primary button label' },
  /*
   * Solid fills other than `accent`, added when the solve screen needed a
   * success-coloured primary and a measured destructive confirm.
   *
   * Before this, `accent-foreground on accent` was the ONLY fill with a
   * measured foreground, which is why every solid button in the app was blue —
   * including ones that meant "finished" and "discard". `ConfirmDialog` was
   * already painting `--background` on `--danger` with nothing checking it.
   */
  { foreground: 'accent-foreground', background: 'success', usage: 'Solved button label' },
  { foreground: 'background', background: 'danger', usage: 'destructive confirm label' },
  { foreground: 'success', background: 'background', usage: 'success message' },
  { foreground: 'success', background: 'surface', usage: 'success stat on a card' },
  { foreground: 'warning', background: 'background', usage: 'warning message' },
  { foreground: 'warning', background: 'surface', usage: 'warning stat on a card' },
  { foreground: 'danger', background: 'background', usage: 'error message' },
  { foreground: 'danger', background: 'surface', usage: 'error text on a card' },
  /*
   * The timer bar sits on `--surface-raised` and carries a danger-toned
   * Abandon and its error line. Only the `text-primary` and `text-muted`
   * pairings on that surface were declared, so these rendered unmeasured.
   */
  {
    foreground: 'danger',
    background: 'surface-raised',
    usage: 'destructive action in the timer bar',
  },
  { foreground: 'accent', background: 'surface-raised', usage: 'link on a raised surface' },
  /* StatusMark renders its word in these on the raised "Your record" card. */
  {
    foreground: 'success',
    background: 'surface-raised',
    usage: 'solved status on a raised card',
  },
  {
    foreground: 'warning',
    background: 'surface-raised',
    usage: 'attempted status on a raised card',
  },
];

/** Non-text pairs held to WCAG 1.4.11 (3:1): borders, focus rings, chart strokes. */
export const NON_TEXT_PAIRS: Array<{
  foreground: TokenName;
  background: TokenName;
  usage: string;
}> = [
  { foreground: 'border', background: 'background', usage: 'card and input borders' },
  { foreground: 'border', background: 'surface', usage: 'divider inside a card' },
  { foreground: 'focus-ring', background: 'background', usage: 'focus ring on the page' },
  { foreground: 'focus-ring', background: 'surface', usage: 'focus ring on a card' },
  { foreground: 'border', background: 'surface-raised', usage: 'divider on a raised surface' },
  {
    foreground: 'focus-ring',
    background: 'surface-raised',
    usage: 'focus ring in the timer bar',
  },
];
