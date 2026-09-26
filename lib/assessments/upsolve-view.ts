/**
 * F4.5 · the upsolve queue, in the client-safe layer (`components/` may not
 * import from `server/`, F0.1).
 */

export type UpsolveItemView = {
  problemId: string;
  slug: string;
  title: string;
  difficulty: 'easy' | 'medium' | 'hard';
  /** The assessment this problem was left unsolved in (the most recent one). */
  attemptId: string;
  paperTitle: string;
  /** ISO timestamp of that attempt's submission. */
  submittedAt: string;
  /** True when it was opened but not solved; false when never opened at all. */
  attempted: boolean;
};
