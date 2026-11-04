/**
 * The v2 solve screen's markers, one definition each, used by the components
 * and by the specs.
 *
 * `e2e/solve-v2-off.spec.ts` asserts that NONE of these strings appears in any
 * response /solve returns with the flag off: HTML, RSC payload and JS chunks.
 * Every v2 component carries one, so v2 code reaching v1's client bundle fails
 * CI instead of shipping quietly. `e2e/solve-v2-*.spec.ts` assert they are
 * present with the flag on.
 */

/** `data-testid` on `SolveShellV2`'s root (server component, C1). */
export const SOLVE_V2_MARKER = 'solve-v2-shell';

/** `data-solve-v2-strip` on `SessionStripV2`'s root (client component, C2). */
export const SOLVE_V2_STRIP_MARKER = 'solve-v2-strip';

/** `data-solve-v2-history` on `HistoryCardV2`'s root (server component, C3). */
export const SOLVE_V2_HISTORY_MARKER = 'solve-v2-history';

/** `data-solve-v2-recurring` on `RecurringChipV2`'s root (server component, C4). */
export const SOLVE_V2_RECURRING_MARKER = 'solve-v2-recurring';

/** Every marker the flag-off check must find nowhere. */
export const SOLVE_V2_MARKERS = [
  SOLVE_V2_MARKER,
  SOLVE_V2_STRIP_MARKER,
  SOLVE_V2_HISTORY_MARKER,
  SOLVE_V2_RECURRING_MARKER,
] as const;
