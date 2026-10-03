import Link from 'next/link';
import { Avatar, type AvatarAppearanceProps } from '@/components/avatar/Avatar';
import { GoalProgressRing } from './GoalProgressRing';
import { StreakBadge } from './StreakBadge';
import { ThemeToggle } from './ThemeToggle';
import { DIAG_PREFETCH } from '@/lib/diag-prefetch';

/**
 * Top bar. Every dynamic value arrives as a prop — F1.3 supplies the real
 * streak and goal numbers; this component never queries.
 */
export function TopBar({
  streakDays,
  streakAtRisk,
  goalCompleted,
  goalTarget,
  goalMet,
  avatarUrl,
  avatarAppearance,
}: {
  streakDays: number;
  streakAtRisk?: boolean;
  goalCompleted: number;
  goalTarget: number;
  goalMet?: boolean;
  avatarUrl: string | null;
  avatarAppearance: AvatarAppearanceProps;
}) {
  return (
    <header className="flex items-center justify-between gap-4 border-b border-[var(--border)] bg-[var(--surface)] px-4 py-2">
      {/*
       * `min-w-0` is load-bearing, not tidying. A flex item defaults to
       * `min-width: auto`, so this span refuses to shrink below the width of
       * the word — and at 375px the wordmark plus the controls, their gaps and
       * the header padding come to a little more than the viewport. The span
       * held its ground and pushed the controls past the right edge instead,
       * giving the whole page two pixels of horizontal scroll.
       *
       * Two pixels on Linux and none on Windows, because the overflow is that
       * marginal and the two platforms measure this font slightly differently.
       * `e2e/native-platform.spec.ts` and `e2e/viewports.spec.ts` assert the
       * page never scrolls sideways, and they caught it the first time CI ran
       * them on Linux.
       */}
      <span className="min-w-0 truncate font-semibold tracking-tight">Quadrantcode</span>

      <div className="flex shrink-0 items-center gap-3">
        <StreakBadge days={streakDays} atRisk={streakAtRisk} />
        <GoalProgressRing completed={goalCompleted} met={goalMet} target={goalTarget} />
        <ThemeToggle />
        <Link
          aria-label="Profile settings"
          className="rounded-full"
          href="/settings/profile"
          prefetch={DIAG_PREFETCH}
        >
          <Avatar appearance={avatarAppearance} size={28} src={avatarUrl} />
        </Link>
      </div>
    </header>
  );
}
