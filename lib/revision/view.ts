/**
 * What the revision queue renders, in the client-safe layer.
 *
 * `components/` may not import from `server/` (F0.1), so the shapes the queue
 * returns are declared here and re-exported from it — the same arrangement as
 * `lib/analytics/view.ts` and the three before it.
 */

export type RiskFactorView = {
  key: 'overdue' | 'confidence' | 'failedAttempts' | 'mistakes' | 'topic' | 'hints';
  /** Plain language, naming the number it came from. */
  label: string;
  /** Points of the final score this factor contributed. */
  contribution: number;
};

export type RiskScoreView = {
  /** 0–100, rounded. */
  score: number;
  /** Strongest first, and only the ones that actually contributed. */
  factors: RiskFactorView[];
};

export type DueItemView = {
  problemId: string;
  slug: string;
  title: string;
  dueLocalDate: string;
  daysOverdue: number;
  intervalDays: number;
  ladderKind: 'standard' | 'compressed';
  ladderIndex: number;
  risk: RiskScoreView;
};

export type DueQueueView = {
  items: DueItemView[];
  /** Everything due, including what the cap held back. */
  totalDue: number;
  cap: number;
};

/** How long until this comes back, said the way a person would say it. */
export function formatInterval(days: number): string {
  if (days === 1) return 'tomorrow';
  if (days < 7) return `in ${days} days`;
  if (days === 7) return 'in a week';
  if (days < 30) return `in ${Math.round(days / 7)} weeks`;
  return 'in a month';
}

/** "due today" or "3 days overdue" — never a bare date the reader has to subtract. */
export function formatDueness(daysOverdue: number): string {
  if (daysOverdue <= 0) return 'due today';
  return `${daysOverdue} ${daysOverdue === 1 ? 'day' : 'days'} overdue`;
}
