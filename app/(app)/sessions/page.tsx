/**
 * Every sitting, newest first.
 *
 * The sidebar has always linked to `/sessions` and it has always been a 404.
 * F3.2b adds `/sessions/[id]`, and a detail page reachable only by typing a
 * uuid is a detail page nobody opens — the same argument that put `/revision`
 * in F2.1 (**D23**).
 *
 * Deliberately minimal. This is not the ticket's feature; it is the door to it.
 */
import Link from 'next/link';
import { desc, eq } from 'drizzle-orm';
import { PageHeader } from '@/components/ui/PageHeader';
import { EmptyState } from '@/components/ui/EmptyState';
import { getDb } from '@/server/db';
import { problems, solveSessions } from '@/server/db/schema';
import { requireCurrentUser } from '@/server/services/auth/session';
import { formatElapsed } from '@/lib/timeline/view';

export default async function SessionsPage() {
  const user = await requireCurrentUser();

  const rows = await getDb()
    .select({
      id: solveSessions.id,
      status: solveSessions.status,
      startedAt: solveSessions.startedAt,
      endedAt: solveSessions.endedAt,
      title: problems.title,
    })
    .from(solveSessions)
    .innerJoin(problems, eq(problems.id, solveSessions.problemId))
    .where(eq(solveSessions.userId, user.id))
    .orderBy(desc(solveSessions.startedAt))
    .limit(50);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        description="Every sitting you have recorded. Open one to see how it went."
        title="Sessions"
      />

      {rows.length === 0 ? (
        <EmptyState
          description="Start a session from any problem and it will appear here."
          title="No sessions yet"
        />
      ) : (
        <ol aria-label="Your sessions" className="flex flex-col gap-2">
          {rows.map((row) => (
            <li
              className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-3"
              key={row.id}
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <Link className="font-medium underline" href={`/sessions/${row.id}`}>
                  {row.title}
                </Link>
                <span className="text-sm text-[var(--text-muted)]">
                  {row.status}
                  {row.endedAt
                    ? ` · ${formatElapsed(row.endedAt.getTime() - row.startedAt.getTime())}`
                    : ''}
                </span>
              </div>
              <p className="mt-0.5 text-xs text-[var(--text-muted)]">
                {row.startedAt.toISOString().slice(0, 16).replace('T', ' ')}
              </p>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
