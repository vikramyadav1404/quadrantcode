/**
 * F2.2 · the four revision modes, declared once.
 *
 * The `revision_mode` pgEnum is built from this array, the start action
 * validates against it, and the page renders its labels — three consumers, one
 * list, the arrangement D21 set for the reflection taxonomy. Client-safe on
 * purpose: `components/` may not import from `server/` (F0.1).
 */

export const REVISION_MODES = ['blind', 'mistake_first', 'pattern', 'speed'] as const;

export type RevisionMode = (typeof REVISION_MODES)[number];

export const REVISION_MODE_LABELS: Record<
  RevisionMode,
  { label: string; description: string }
> = {
  blind: {
    label: 'Blind retry',
    description: 'No notes, no previous code. Your last attempt is shown once you finish.',
  },
  mistake_first: {
    label: 'Mistake-first',
    description: 'See what went wrong last time before you start.',
  },
  pattern: {
    label: 'Pattern set',
    description: 'Revise it alongside two or three problems that share its pattern.',
  },
  speed: {
    label: 'Speed',
    description: 'Beat a target time: your best, or the estimate, whichever is lower.',
  },
};

/**
 * Below this many measured revisions the comparison says "not enough data"
 * instead of naming a winner. The ticket's number, and the reason for it: with
 * a handful of revisions, which mode "worked" is mostly which problems happened
 * to be easy.
 */
export const MODE_COMPARISON_MINIMUM = 10;

export type ModeStatView = {
  mode: RevisionMode;
  /** Revisions in this mode that have a later attempt to measure retention by. */
  measured: number;
  /** How many of those were followed by a solved attempt. */
  retained: number;
};

export type ModeComparisonView =
  | { enough: false; measured: number; minimum: number }
  | {
      enough: true;
      measured: number;
      modes: ModeStatView[];
      /** Null when no mode has a measured revision, or when the best rates tie. */
      best: RevisionMode | null;
    };

/** What the solve page needs to know about a live revision sitting. */
export type RevisionSittingView =
  | { mode: 'blind' }
  | {
      mode: 'mistake_first';
      lastAttemptedAt: string | null;
      mistakes: string[];
      stuckPoints: { category: string; note: string | null; atSeconds: number }[];
    }
  | { mode: 'pattern'; pattern: string | null; related: { slug: string; title: string }[] }
  | { mode: 'speed'; targetSeconds: number };
