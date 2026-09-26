/**
 * F4.2 · what a preparation track renders, in the client-safe layer.
 */

export type TrackProblemView = {
  slug: string;
  title: string;
  difficulty: 'easy' | 'medium' | 'hard';
  solved: boolean;
};

export type TrackSectionView = {
  id: string;
  title: string;
  /** Titles of the sections that must be finished first. */
  requires: string[];
  /** False while a prerequisite is unfinished: the section cannot be entered. */
  unlocked: boolean;
  complete: boolean;
  solved: number;
  /** Problems are listed even when locked, so the path is visible; links are not. */
  problems: TrackProblemView[];
};

export type TrackView = {
  slug: string;
  title: string;
  description: string;
  sections: TrackSectionView[];
  total: number;
  solved: number;
  percent: number;
  /** The first unsolved problem in the first unlocked, unfinished section. */
  next: { slug: string; title: string } | null;
  /** Remaining time from THIS user's measured speed; see `estimate.ts`. */
  remainingMinutes: number;
  /** True until the user has solved something the estimate can learn from. */
  estimateFromDefaults: boolean;
  /** Declared problems not in the catalog today, so not shown and not counted. */
  unavailable: number;
};

export type TrackSummaryView = Pick<
  TrackView,
  'slug' | 'title' | 'description' | 'total' | 'solved' | 'percent'
>;
