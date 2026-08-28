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
 * the three outcomes. F2.2's four revision MODES stay cut; nothing here
 * pretends otherwise.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { DueList } from '@/components/revision/DueList';
import { PageHeader } from '@/components/ui/PageHeader';
import { getDb } from '@/server/db';
import { requireCurrentUser } from '@/server/services/auth/session';
import { dueToday } from '@/server/services/revision';
import { localDateFor } from '@/server/services/streak';
import { recordRevisionAction } from './actions';

export const metadata: Metadata = { title: 'Revision · TraceLoop' };

export default async function RevisionPage() {
  const user = await requireCurrentUser();

  const today = localDateFor(new Date(), user.timezone);
  const queue = await dueToday(getDb(), { userId: user.id, today });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Revision" description="What is due today, hardest first." />

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

          <DueList items={queue.items} onRecord={recordRevisionAction} />
        </>
      )}
    </div>
  );
}
