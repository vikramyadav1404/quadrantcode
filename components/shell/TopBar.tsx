import Link from 'next/link';
import { Avatar, type AvatarAppearanceProps } from '@/components/avatar/Avatar';
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
  avatarUrl,
  avatarAppearance,
}: {
  streakDays: number;
  streakAtRisk?: boolean;
  goalCompleted: number;
  goalTarget: number;
  avatarUrl: string | null;
  avatarAppearance: AvatarAppearanceProps;
}) {
  return (
    <header className="flex items-center justify-between gap-4 border-b border-[var(--border)] bg-[var(--surface)] px-4 py-2">
      <span className="font-semibold tracking-tight">TraceLoop</span>

      <div className="flex items-center gap-3">
        <StreakBadge days={streakDays} atRisk={streakAtRisk} />
        <GoalProgressRing completed={goalCompleted} target={goalTarget} />
        <ThemeToggle />
        <Link aria-label="Profile settings" className="rounded-full" href="/settings/profile">
          <Avatar appearance={avatarAppearance} size={28} src={avatarUrl} />
        </Link>
      </div>
    </header>
  );
}
