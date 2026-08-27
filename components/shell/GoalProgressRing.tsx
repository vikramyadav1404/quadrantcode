/**
 * Daily-goal progress ring. Pure presentation over its props.
 *
 * `role="img"` with an explicit label, because a screen reader cannot infer
 * "2 of 3 solved" from an SVG arc.
 */
export function GoalProgressRing({
  completed,
  target,
  met = false,
  size = 32,
}: {
  completed: number;
  target: number;
  /**
   * The day counts toward the streak, whatever the count says.
   *
   * A day also completes at one solve alongside two revisions (F1.3's rule),
   * so `completed` can sit below `target` on a day that is genuinely done.
   * Without this the ring shows 1 of 2 next to a badge that has already
   * counted the day. The count stays honest — this fills the arc, it does not
   * inflate the number.
   */
  met?: boolean;
  size?: number;
}) {
  const safeTarget = Math.max(1, target);
  const fraction = met ? 1 : Math.min(1, completed / safeTarget);

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
      aria-label={
        met
          ? `Daily goal met: ${completed} of ${target} solved`
          : `Daily goal: ${completed} of ${target} solved`
      }
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
