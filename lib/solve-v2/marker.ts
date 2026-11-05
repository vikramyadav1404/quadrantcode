/**
 * The solve screen's markers, one definition each, used by the components and
 * by `e2e/solve-v2-*.spec.ts`, which find each part by them.
 *
 * Until #40 (2026-11-05) they also proved v2 code never reached v1's bundle,
 * through a flag-off spec. v1 and the flag are gone, and that spec with them.
 */

/** `data-testid` on `SolveShellV2`'s root (server component, C1). */
export const SOLVE_V2_MARKER = 'solve-v2-shell';

/** `data-solve-v2-strip` on `SessionStripV2`'s root (client component, C2). */
export const SOLVE_V2_STRIP_MARKER = 'solve-v2-strip';

/** `data-solve-v2-history` on `HistoryCardV2`'s root (server component, C3). */
export const SOLVE_V2_HISTORY_MARKER = 'solve-v2-history';

/** `data-solve-v2-recurring` on `RecurringChipV2`'s root (server component, C4). */
export const SOLVE_V2_RECURRING_MARKER = 'solve-v2-recurring';

/** `data-solve-v2-run-panel` on `RunPanelV2`'s root (client component, C5). */
export const SOLVE_V2_RUN_PANEL_MARKER = 'solve-v2-run-panel';
