/**
 * Active minutes per solved problem, twelve seven-day buckets ending today.
 *
 * ## A week with no solves is drawn as empty, not as zero
 *
 * Zero minutes per problem is a claim — that problems were solved instantly.
 * A week with nothing in it has no average at all, and the difference matters
 * on a chart about whether the user is getting faster: a run of zeroes would
 * read as an improvement.
 *
 * Inline SVG for the same reason as the difficulty split: twelve rectangles do
 * not justify a client-side charting dependency, and this way the whole page
 * stays a server component.
 */
import type { TrendPoint } from '@/lib/analytics/view';

const WIDTH = 100;
const HEIGHT = 40;
const GAP = 1.5;

export function SpeedTrend({ trend }: { trend: TrendPoint[] }) {
  const values = trend
    .map((point) => point.averageMinutesPerProblem)
    .filter((value): value is number => value !== null);

  if (values.length === 0) {
    return (
      <p className="text-sm text-[var(--text-muted)]">
        No solves in the last twelve weeks, so there is no trend to draw yet.
      </p>
    );
  }

  const peak = Math.max(...values);
  const barWidth = WIDTH / trend.length - GAP;

  const summary = trend
    .map((point) =>
      point.averageMinutesPerProblem === null
        ? `${point.weekStart}: no solves`
        : `${point.weekStart}: ${point.averageMinutesPerProblem} minutes`,
    )
    .join('; ');

  return (
    <div className="flex flex-col gap-2">
      <svg
        aria-label={`Average active minutes per solved problem by week. ${summary}`}
        className="w-full"
        height="80"
        role="img"
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        preserveAspectRatio="none"
      >
        {trend.map((point, index) => {
          const x = index * (WIDTH / trend.length);

          if (point.averageMinutesPerProblem === null) {
            /*
             * A dash on the baseline: something happened here (a week passed)
             * and there is nothing to report, which is different from a bar of
             * height zero.
             */
            return (
              <rect
                fill="var(--border)"
                height="1"
                key={point.weekStart}
                width={barWidth}
                x={x}
                y={HEIGHT - 1}
              />
            );
          }

          const height = Math.max(1, (point.averageMinutesPerProblem / peak) * HEIGHT);

          return (
            <rect
              fill="var(--accent)"
              height={height}
              key={point.weekStart}
              width={barWidth}
              x={x}
              y={HEIGHT - height}
            />
          );
        })}
      </svg>

      <p className="flex justify-between text-xs text-[var(--text-muted)]">
        <span>{trend[0]?.weekStart}</span>
        <span>peak {peak}m per problem</span>
        <span>this week</span>
      </p>
    </div>
  );
}
