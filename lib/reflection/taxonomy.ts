/**
 * The reflection taxonomy — **declared once, here.**
 *
 * The ticket asks for it "documented in one place and imported everywhere, never
 * re-declared", and the reason is concrete: this list has to be identical in
 * three places that cannot see each other. A Postgres enum in
 * `server/db/schema/enums.ts`, a Zod schema validating a form post, and the
 * checkboxes a user ticks. Write it three times and one day they differ — the
 * symptom being a category the form offers and the database rejects, on submit,
 * after the user has typed a paragraph.
 *
 * So the arrays below are the source, `pgEnum` is built from them, and the UI
 * reads its labels from them. Adding a category is a one-line change plus a
 * migration, and nothing can drift in between.
 *
 * It lives in `lib/` rather than `server/` because `components/` may not import
 * from `server/` (deny-by-default, F0.1) and the form needs these values — the
 * same reason `lib/streak/heatmap-day.ts` exists.
 */

/**
 * Where a solve got stuck.
 *
 * Used twice, deliberately: by a stuck marker dropped DURING a session, and by
 * the "where were you stuck" question asked afterwards. One vocabulary, so
 * F3.3's inferred regions and F3.5's mistake analytics can compare a marker
 * made in the moment against a memory formed later — which is only meaningful
 * if both sides use the same words.
 */
export const STUCK_CATEGORIES = [
  'understanding',
  'approach',
  'implementation',
  'edge_cases',
  'debugging',
  'complexity',
] as const;

export type StuckCategory = (typeof STUCK_CATEGORIES)[number];

/**
 * What actually went wrong.
 *
 * `none` is a real answer and not a null: "I solved it cleanly" is information,
 * and leaving the field empty is indistinguishable from skipping the question.
 * F3.5 counts recurrences, and a skipped question must not read as a clean solve.
 */
export const MISTAKE_CATEGORIES = [
  'wrong_logic',
  'boundary_condition',
  'off_by_one',
  'wrong_data_structure',
  'missed_edge_case',
  'recursion_base_case',
  'syntax_runtime',
  'tle',
  'none',
] as const;

export type MistakeCategory = (typeof MISTAKE_CATEGORIES)[number];

/**
 * Who said so.
 *
 * Present from the first migration even though F1.5 only ever writes `user`.
 * F3.3 infers stuck points into the same table, and its own criterion is that
 * confirmed and inferred be "separable in a single SQL query". Adding the column
 * later would mean backfilling every existing row with an assumption — cheaper
 * and more honest to record it while the answer is known.
 */
export const STUCK_SOURCES = ['user', 'inferred'] as const;

export type StuckSource = (typeof STUCK_SOURCES)[number];

/** Human labels. Kept beside the values so a new category cannot ship unlabelled. */
export const STUCK_CATEGORY_LABELS: Record<StuckCategory, string> = {
  understanding: 'Understanding the problem',
  approach: 'Choosing an approach',
  implementation: 'Writing the code',
  edge_cases: 'Edge cases',
  debugging: 'Debugging',
  complexity: 'Time or space complexity',
};

export const MISTAKE_CATEGORY_LABELS: Record<MistakeCategory, string> = {
  wrong_logic: 'Wrong logic',
  boundary_condition: 'Boundary condition',
  off_by_one: 'Off by one',
  wrong_data_structure: 'Wrong data structure',
  missed_edge_case: 'Missed an edge case',
  recursion_base_case: 'Recursion base case',
  syntax_runtime: 'Syntax or runtime error',
  tle: 'Too slow (TLE)',
  none: 'Nothing went wrong',
};

export function isStuckCategory(value: unknown): value is StuckCategory {
  return (STUCK_CATEGORIES as readonly unknown[]).includes(value);
}

export function isMistakeCategory(value: unknown): value is MistakeCategory {
  return (MISTAKE_CATEGORIES as readonly unknown[]).includes(value);
}
