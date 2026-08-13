/**
 * Prints the measured contrast ratio for every token pair, and exits non-zero
 * if any fails. Run it after touching a colour:
 *
 *   npx tsx scripts/contrast.ts
 *
 * The numbers it prints are the ones pasted into styles/tokens.css. Nothing is
 * waived — a failing pair means the token changes.
 */
import { NON_TEXT_PAIRS, TEXT_PAIRS, TOKENS, type ThemeName } from '@/lib/design-tokens';
import { WCAG_AA_BODY, WCAG_AA_NON_TEXT, contrastRatio, formatRatio } from '@/lib/contrast';

let failures = 0;

for (const theme of ['dark', 'light'] as ThemeName[]) {
  const palette = TOKENS[theme];
  console.log(`\n── ${theme.toUpperCase()} ${'─'.repeat(60)}`);
  console.log('ratio   min   pair'.padEnd(70));

  for (const pair of TEXT_PAIRS) {
    const ratio = contrastRatio(palette[pair.foreground], palette[pair.background]);
    const ok = ratio >= WCAG_AA_BODY;
    if (!ok) failures += 1;
    console.log(
      `${ok ? 'PASS' : 'FAIL'} ${formatRatio(ratio).padStart(6)} ${String(WCAG_AA_BODY).padStart(5)}  ` +
        `${pair.foreground} on ${pair.background} — ${pair.usage}`,
    );
  }

  for (const pair of NON_TEXT_PAIRS) {
    const ratio = contrastRatio(palette[pair.foreground], palette[pair.background]);
    const ok = ratio >= WCAG_AA_NON_TEXT;
    if (!ok) failures += 1;
    console.log(
      `${ok ? 'PASS' : 'FAIL'} ${formatRatio(ratio).padStart(6)} ${String(WCAG_AA_NON_TEXT).padStart(5)}  ` +
        `${pair.foreground} on ${pair.background} — ${pair.usage} (non-text)`,
    );
  }
}

console.log(`\n${failures === 0 ? 'All pairs pass.' : `${failures} pair(s) FAIL.`}`);
process.exit(failures === 0 ? 0 : 1);
