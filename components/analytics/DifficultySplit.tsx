/**
 * How the solves split across easy, medium and hard.
 *
 * Inline SVG rather than a charting library: three rectangles and a legend do
 * not justify a client-side dependency, and drawing them here keeps the whole
 * page a server component — which is the point of a rollup-backed dashboard.
 *
 * Colour is never the only channel. Each segment is labelled in the legend with
 * its own count, so the chart survives greyscale, colourblindness and a
 * screenshot — the same rule F1.3's heatmap follows for frozen days.
 */
import type { DifficultySplit as Split } from '@/lib/analytics/view';

const SEGMENTS = [
  { key: 'easy', label: 'Easy', fill: 'var(--success)' },
  { key: 'medium', label: 'Medium', fill: 'var(--accent)' },
  { key: 'hard', label: 'Hard', fill: 'var(--warning)' },
] as const;

export function DifficultySplit({ split }: { split: Split }) {
  const total = split.easy + split.medium + split.hard;

  if (total === 0) {
    return (
      <p className="text-sm text-[var(--text-muted)]">
        Nothing solved yet — the split appears once you finish a problem.
      </p>
    );
  }

  let offset = 0;
  const bars = SEGMENTS.map((segment) => {
    const value = split[segment.key];
    const width = (value / total) * 100;
    const bar = { ...segment, value, width, x: offset };
    offset += width;
    return bar;
  });

  const label = bars.map((bar) => `${bar.label} ${bar.value}`).join(', ');

  return (
    <div className="flex flex-col gap-2">
      <svg
        aria-label={`Solved by difficulty: ${label}`}
        className="w-full"
        height="16"
        role="img"
        viewBox="0 0 100 16"
        preserveAspectRatio="none"
      >
        {bars
          .filter((bar) => bar.value > 0)
          .map((bar) => (
            <rect fill={bar.fill} height="16" key={bar.key} width={bar.width} x={bar.x} y="0" />
          ))}
      </svg>

      <ul className="flex flex-wrap gap-4 text-sm">
        {bars.map((bar) => (
          <li className="flex items-center gap-2" key={bar.key}>
            <span
              aria-hidden="true"
              className="inline-block size-3 rounded-sm"
              style={{ backgroundColor: bar.fill }}
            />
            <span className="text-[var(--text-muted)]">{bar.label}</span>
            <span className="tabular-nums">{bar.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
