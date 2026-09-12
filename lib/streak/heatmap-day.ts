/**
 * The heatmap cell contract, in the CLIENT-SAFE layer.
 *
 * It lives here rather than in `server/services/streak/heatmap.ts` because
 * `components/` is deny-by-default for `server/` imports — the guard F0.1
 * established, and it fired on this file when the type was imported across that
 * line. Even a type-only import is the wrong shape: a shared contract between a
 * server query and a component belongs to neither of them.
 *
 * The rule was NOT disabled to make this compile. That is the whole point of a
 * deny-by-default boundary: the fix is to move the thing, not to widen the gate.
 */

/**
 * What a single day meant.
 *
 * `solved` and `frozen` BOTH count toward the streak and are deliberately
 * distinct: only one of them is something the user did. See D18.
 */
export type HeatmapDayKind = 'solved' | 'frozen' | 'partial' | 'empty';

export type HeatmapDay = {
  /** `YYYY-MM-DD` in the user's timezone. */
  date: string;
  solvedCount: number;
  revisionCount: number;
  kind: HeatmapDayKind;
};
