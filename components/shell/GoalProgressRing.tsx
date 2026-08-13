/**
 * Daily-goal progress ring. Pure presentation over two props.
 *
 * `role="img"` with an explicit label, because a screen reader cannot infer
 * "2 of 3 solved" from an SVG arc.
 */
export function GoalProgressRing({
  completed,
  target,
  size = 32,
}: {
  completed: number;
  target: number;
  size?: number;
}) {
  const safeTarget = Math.max(1, target);
  const fraction = Math.min(1, completed / safeTarget);

  const stroke = 3;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const done = fraction >= 1;

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label={`Daily goal: ${completed} of ${target} complete`}
    >
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="var(--border)"
        strokeWidth={stroke}
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke={done ? 'var(--success)' : 'var(--accent)'}
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={circumference * (1 - fraction)}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
      <text
        x="50%"
        y="50%"
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={size * 0.34}
        fill="var(--text-primary)"
      >
        {completed}
      </text>
    </svg>
  );
}
