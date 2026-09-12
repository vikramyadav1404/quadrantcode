/**
 * What the analytics page renders, in the client-safe layer.
 *
 * `components/` may not import from `server/` (deny-by-default, F0.1), so the
 * shapes the service returns are declared here and re-exported from it — the
 * same arrangement as `lib/streak/heatmap-day.ts`, `lib/session/timer-bar-state.ts`
 * and `lib/reflection/attempt-view.ts`.
 *
 * Everything below is a number the server already computed. Nothing here
 * recalculates: a component that did its own arithmetic would be a second
 * implementation of the formula, and the two would eventually disagree on the
 * same screen.
 */

/** The four parts of a weak-topic score, each normalised to 0..1. */
export type ScoreComponents = {
  staleness: number;
  failureRate: number;
  lowConfidence: number;
  slowness: number;
};

export type WeakTopic = {
  topic: string;
  /** 0..100, rounded. Higher means more in need of attention. */
  score: number;
  components: ScoreComponents;
  /**
   * Plain sentences, strongest contributor first, and **never empty**.
   *
   * The panel renders these beside the number. A score with no account of
   * itself is a number the reader cannot argue with, and will therefore ignore.
   */
  reasons: string[];
  daysSincePractice: number;
  failureRate: number;
  averageConfidence: number | null;
};

export type TopicRow = {
  topic: string;
  solvedCount: number;
  stuckCount: number;
  sessionCount: number;
  averageActiveSeconds: number | null;
  failedAttemptRatio: number;
  averageConfidence: number | null;
  lastPractisedDate: string | null;
};

export type TrendPoint = {
  /** First day of the seven-day bucket. */
  weekStart: string;
  /** Active minutes per problem solved, or null when nothing was solved that week. */
  averageMinutesPerProblem: number | null;
};

export type DifficultySplit = { easy: number; medium: number; hard: number };

export type StuckDistributionRow = { category: string; marked: number; reflected: number };

export type DashboardData = {
  /** When the rollup behind these numbers was computed. Null when nothing is rolled up yet. */
  asOf: Date | null;
  /** True when older days are still waiting to be rolled up. */
  catchingUp: boolean;
  headline: {
    currentStreak: number;
    longestStreak: number;
    totalSolved: number;
    solvedThisWeek: number;
    averageActiveSeconds: number | null;
  };
  difficulty: DifficultySplit;
  topics: TopicRow[];
  weakTopics: WeakTopic[];
  trend: TrendPoint[];
  stuckDistribution: StuckDistributionRow[];
};

/** `42m` or `1h 07m`. Em dash when there is nothing to report. */
export function formatDuration(seconds: number | null): string {
  if (seconds === null || seconds <= 0) return '—';

  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;

  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`;
}

/**
 * The 1..3 average back into a word.
 *
 * Rounded to the nearest answer the user could actually have given, because
 * "2.4" is a number nobody typed and reads as more precise than it is.
 */
export function formatConfidence(average: number | null): string {
  if (average === null) return '—';
  if (average < 1.5) return 'low';
  if (average < 2.5) return 'medium';
  return 'high';
}

/** `1 in 4` reads more plainly than `0.25` for a ratio out of sessions. */
export function formatRatio(ratio: number, of: number): string {
  if (of === 0 || ratio === 0) return 'none';
  return `${Math.round(ratio * of)} of ${of}`;
}

/**
 * "as of 14:32 today", or the date when it is older.
 *
 * The page states this because the numbers ARE precomputed. Showing a rollup as
 * though it were live is the failure the ticket's performance section names.
 */
export function formatAsOf(asOf: Date | null, now: Date): string {
  if (!asOf) return 'not computed yet';

  const sameDay = asOf.toDateString() === now.toDateString();
  const time = asOf.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

  return sameDay ? `as of ${time} today` : `as of ${asOf.toLocaleDateString()}`;
}
