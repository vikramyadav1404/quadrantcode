/**
 * GitHub-style 365-day contribution heatmap.
 *
 * A FROZEN DAY LOOKS DIFFERENT FROM A SOLVED ONE, and that is the whole
 * design point rather than a styling choice. Both count toward the streak; only
 * one of them is something the user did. Rendering them identically would show
 * an unbroken wall of green across days they did not solve, and they would
 * believe it — a stronger failure than confusion, because they are confidently
 * wrong about their own history.
 *
 * Frozen cells therefore get their own colour AND a diagonal hatch, so the
 * distinction survives greyscale, a colourblind viewer, and a screenshot.
 * Colour alone would fail all three.
 */
import type { HeatmapDay } from '@/lib/streak/heatmap-day';

const CELL: Record<HeatmapDay['kind'], string> = {
  solved: 'bg-[var(--accent)]',
  // Distinct hue, not a lighter accent — "less green" reads as "less activity",
  // which is not what a freeze means.
  frozen: 'bg-[var(--warning)]',
  partial: 'bg-[var(--accent)]/40',
  empty: 'bg-[var(--surface-raised)]',
};

/**
 * The frozen-cell hatch, from the token layer.
 *
 * `tests/design/tokens.test.ts` forbids colour functions anywhere under
 * `components/`, and it rejected two attempts here: first a literal translucent
 * black, then a token blended at the point of use. The rule is right and the
 * fix was to move the value rather than widen the rule — `--freeze-hatch` is
 * defined per theme in `styles/tokens.css`, so it adapts to light mode too.
 *
 * (It rejected a third time on this very comment, because the guard greps raw
 * source and cannot tell discussion from use. Reworded rather than loosened: a
 * guard with a small false-positive surface is worth more than one I taught
 * myself to edit around.)
 */
const FREEZE_HATCH = { backgroundImage: 'var(--freeze-hatch)' } as const;

function describe(day: HeatmapDay): string {
  const counts = `${day.solvedCount} solved, ${day.revisionCount} revised`;
  switch (day.kind) {
    case 'frozen':
      // Says what happened, not just that it counted.
      return `${day.date}: missed — covered by a streak freeze (${counts})`;
    case 'solved':
      return `${day.date}: goal met (${counts})`;
    case 'partial':
      return `${day.date}: some activity, goal not met (${counts})`;
    default:
      return `${day.date}: nothing logged`;
  }
}

export function Heatmap({ days }: { days: readonly HeatmapDay[] }) {
  return (
    <figure className="flex flex-col gap-3">
      <div
        className="grid grid-flow-col grid-rows-7 gap-[3px] overflow-x-auto pb-2"
        role="img"
        aria-label={`Activity for the last ${days.length} days. ${
          days.filter((day) => day.kind === 'solved').length
        } days met the goal, ${days.filter((day) => day.kind === 'frozen').length} were covered by a streak freeze.`}
      >
        {days.map((day) => (
          <span
            className={`h-[11px] w-[11px] rounded-[2px] ${CELL[day.kind]}`}
            key={day.date}
            style={day.kind === 'frozen' ? FREEZE_HATCH : undefined}
            /* Native title: a tooltip that survives with JS disabled, and is
               reachable by assistive tech without a custom widget. */
            title={describe(day)}
          />
        ))}
      </div>

      <figcaption className="flex flex-wrap items-center gap-3 text-xs text-[var(--text-muted)]">
        <span className="flex items-center gap-1">
          <span className={`h-[11px] w-[11px] rounded-[2px] ${CELL.solved}`} /> Goal met
        </span>
        <span className="flex items-center gap-1">
          <span className={`h-[11px] w-[11px] rounded-[2px] ${CELL.partial}`} /> Some activity
        </span>
        <span className="flex items-center gap-1">
          <span
            className={`h-[11px] w-[11px] rounded-[2px] ${CELL.frozen}`}
            style={FREEZE_HATCH}
          />{' '}
          Streak freeze
        </span>
        <span className="flex items-center gap-1">
          <span className={`h-[11px] w-[11px] rounded-[2px] ${CELL.empty}`} /> Nothing logged
        </span>
      </figcaption>

      {/* Stated in words as well as in the key: a freeze kept the streak alive,
          it does not mean the day was solved. */}
      <p className="text-xs text-[var(--text-muted)]">
        Streak-freeze days kept your streak going. They are shown separately because you did not
        solve on those days.
      </p>
    </figure>
  );
}
