import { GoalProgressRing } from './GoalProgressRing';
import { StreakBadge } from './StreakBadge';
import { ThemeToggle } from './ThemeToggle';

/**
 * Top bar. Every dynamic value arrives as a prop — F1.3 supplies the real
 * streak and goal numbers; this component never queries.
 */
export function TopBar({
  streakDays,
  streakAtRisk,
  goalCompleted,
  goalTarget,
}: {
  streakDays: number;
  streakAtRisk?: boolean;
  goalCompleted: number;
  goalTarget: number;
}) {
  return (
    <header className="flex items-center justify-between gap-4 border-b border-[var(--border)] bg-[var(--surface)] px-4 py-2">
      <span className="font-semibold tracking-tight">TraceLoop</span>

      <div className="flex items-center gap-3">
        <StreakBadge days={streakDays} atRisk={streakAtRisk} />
        <GoalProgressRing completed={goalCompleted} target={goalTarget} />
        <ThemeToggle />
      </div>
    </header>
  );
}
