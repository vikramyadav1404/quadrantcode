/**
 * The solve screen's shell, rendered by `app/(solve)/problems/[slug]/solve/page.tsx`.
 * Built as "v2" behind FEATURE_SOLVE_V2 (C1 to C6). Since #40 (2026-11-05) it is
 * the only solve screen, and the flag is gone.
 *
 * ## What it holds
 *
 * - C1: the page's `ProblemPanel` and the limits strip, placed in `SplitPane`.
 * - C2: the session strip above them while a sitting is live. The solve
 *   route's layout renders no layout timer bar, so the strip is the only one.
 * - C3 and C4: the history card and the recurring-mistake chip, in one row
 *   under the strip. Both are server components and both are absent in a
 *   blind revision sitting.
 * - C5: the run panel, `RunPanelV2`, in the right pane, with the limits strip
 *   under it.
 *
 * ## Rules
 *
 * - **This file stays a server component.**
 * - **Each component carries a marker** from `lib/solve-v2/marker.ts`, which the
 *   solve specs find it by.
 * - **No Suspense boundary.** D39: a boundary above the timer drops
 *   server-action renders. `tests/app/no-loading-boundary.test.ts` enforces it.
 */
import { SplitPane } from '@/components/solve/SplitPane';
import { SOLVE_V2_MARKER } from '@/lib/solve-v2/marker';
import type { StripEventView } from '@/lib/solve-v2/strip-view';
import type { TimerBarState } from '@/lib/session/timer-bar-state';
import type { Confidence } from '@/lib/session/confidence';
import type { StuckCategory } from '@/lib/reflection/taxonomy';
import { SessionStripV2 } from './SessionStripV2';
import { type HistoryCardData, HistoryCardV2 } from './HistoryCardV2';
import { RecurringChipV2 } from './RecurringChipV2';
import { RunPanelV2 } from './RunPanelV2';
import type { RecurringChipData } from '@/lib/solve-v2/recurring';

type Result = Promise<{ ok: boolean; message?: string }>;

export type SolveShellV2Strip = {
  state: TimerBarState;
  events: StripEventView[];
  onPause: (input: { sessionId: string }) => Result;
  onResume: (input: { sessionId: string }) => Result;
  onAbandon: (input: { sessionId: string }) => Result;
  onComplete: (input: {
    sessionId: string;
    outcome: 'solved' | 'stuck';
    confidence?: Confidence;
  }) => Result;
  onMarkStuck: (input: { sessionId: string; category: StuckCategory; note?: string }) => Result;
};

export function SolveShellV2({
  problemPanel,
  runPanel,
  limits,
  strip,
  history,
  recurring,
}: {
  /** The page's `ProblemPanel`, unchanged. */
  problemPanel: React.ReactNode;
  /** C5 · the run panel's props, built by `load-solve.tsx`. */
  runPanel: React.ComponentProps<typeof RunPanelV2>;
  /** The execution-limits strip, unchanged. */
  limits: React.ReactNode;
  /** The live sitting, if any: the same session the timer bar would show. */
  strip: SolveShellV2Strip | null;
  /** C3 · the history card; null when signed out or in a blind sitting. */
  history: HistoryCardData | null;
  /** C4 · the recurring-mistake chip; null when signed out, blind, or nothing matches. */
  recurring: RecurringChipData | null;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid={SOLVE_V2_MARKER}>
      {strip ? <SessionStripV2 {...strip} /> : null}
      {history || recurring ? (
        <div className="mb-3 flex shrink-0 flex-wrap gap-3">
          {history ? <HistoryCardV2 data={history} /> : null}
          {recurring ? <RecurringChipV2 data={recurring} /> : null}
        </div>
      ) : null}
      <SplitPane
        leftLabel="the problem"
        rightLabel="the editor"
        left={problemPanel}
        right={
          <div className="flex h-full min-h-0 flex-col">
            <div className="min-h-0 flex-1">
              <RunPanelV2 {...runPanel} />
            </div>

            {limits}
          </div>
        }
      />
    </div>
  );
}
