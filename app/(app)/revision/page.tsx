/**
 * F2.1 · what to revise today.
 *
 * ## Why this page exists at all
 *
 * The ticket puts the revision UI out of scope, in F2.2 — **and F2.2 is cut.**
 * Building the engine and nothing else would leave `/revision` in the sidebar
 * pointing at a 404, and a scheduler nobody can reach: the "dead code that
 * looks handled" this project has refused twice already.
 *
 * So this is the smallest honest surface — the due list, in risk order, with
 * the three outcomes.
 *
 * ## F2.2 · modes, behind `FEATURE_REVISION_MODES`
 *
 * F2.2 was re-scoped back in on 2026-09-24 (D34). With the flag on, each item
 * also shows its last attempt, last outcome and recorded mistakes, offers the
 * four modes, and the page states which mode is working — with its sample size,
 * or "not enough data". With the flag off, none of that is loaded and this is
 * F2.1's page exactly.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { UpsolveList } from '@/components/assessments/UpsolveList';
import { DueList } from '@/components/revision/DueList';
import { ModeComparison } from '@/components/revision/ModeComparison';
import { PageHeader } from '@/components/ui/PageHeader';
import { isFeatureEnabled } from '@/lib/flags';
import type { DueItemContextView } from '@/lib/revision/view';
import { getDb } from '@/server/db';
import { requireCurrentUser } from '@/server/services/auth/session';
import { dueToday } from '@/server/services/revision';
import { getUpsolveQueue } from '@/server/services/assessments';
import { modeComparison, revisionContext } from '@/server/services/revision/modes';
import { localDateFor } from '@/server/services/streak';
import { recordRevisionAction, startRevisionSittingAction } from './actions';

export const metadata: Metadata = { title: 'Revision · Quadrantcode' };

export default async function RevisionPage() {
  const user = await requireCurrentUser();

  const today = localDateFor(new Date(), user.timezone);
  const queue = await dueToday(getDb(), { userId: user.id, today });

  // F4.5 · empty for anyone who has never finished an assessment, and the list
  // renders nothing when empty, so this page is unchanged for them.
  const upsolve = await getUpsolveQueue(getDb(), { userId: user.id });

  const modesOn = isFeatureEnabled('FEATURE_REVISION_MODES');
  const [contextByProblem, comparison] = modesOn
    ? await Promise.all([
        revisionContext(getDb(), {
          userId: user.id,
          problemIds: queue.items.map((item) => item.problemId),
        }),
        modeComparison(getDb(), { userId: user.id }),
      ])
    : [null, null];

  const context: Record<string, DueItemContextView> | undefined = contextByProblem
    ? Object.fromEntries(
        [...contextByProblem].map(([problemId, entry]) => [
          problemId,
          {
            lastAttempted: entry.lastAttemptedAt
              ? entry.lastAttemptedAt.toLocaleDateString(undefined, {
                  timeZone: user.timezone,
                  day: 'numeric',
                  month: 'short',
                  year: 'numeric',
                })
              : null,
            lastOutcome: entry.lastOutcome,
            mistakes: entry.mistakes,
          },
        ]),
      )
    : undefined;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Revision" description="What is due today, hardest first." />

      {comparison ? <ModeComparison comparison={comparison} /> : null}

      <UpsolveList heading="Upsolve after assessments" items={upsolve} />

      {queue.totalDue === 0 ? (
        <p className="text-sm text-[var(--text-muted)]">
          Nothing due today. Revisions are scheduled when you solve something —{' '}
          <Link className="underline" href="/problems">
            find a problem
          </Link>
          .
        </p>
      ) : (
        <>
          {/*
            The cap holds work back; it does not hide it. Telling the user they
            have five when they have twenty is the version of this that loses
            their trust the first time they notice.
          */}
          {queue.totalDue > queue.items.length ? (
            <p className="text-sm text-[var(--text-muted)]">
              Showing {queue.items.length} of {queue.totalDue} due — the rest are still waiting,
              in the same order, tomorrow.
            </p>
          ) : null}

          <DueList
            items={queue.items}
            onRecord={recordRevisionAction}
            {...(modesOn && context
              ? { context, onStartMode: startRevisionSittingAction }
              : {})}
          />
        </>
      )}
    </div>
  );
}
