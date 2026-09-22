/**
 * Problem catalog.
 *
 * A Server Component: filters are read from the URL, applied in SQL, and the
 * page is rendered on the server. Nothing about the filtering is client-side,
 * so a user cannot widen their own visibility by editing state.
 */
import Link from 'next/link';
import { PageHeader } from '@/components/ui/PageHeader';
import { EmptyState } from '@/components/ui/EmptyState';
import { DifficultyPill } from '@/components/solve/DifficultyPill';
import { StatusMark } from '@/components/solve/StatusMark';
import { TopicChips } from '@/components/solve/TopicChips';
import { getDb } from '@/server/db';
import { listProblems, parseFilters } from '@/server/services/problems';
import { getCurrentUser } from '@/server/services/auth/session';
import { timed } from '@/server/lib/observability/logger';

export default async function ProblemsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;

  /*
   * TEMPORARY INSTRUMENTATION — remove once the numbers are read.
   *
   * `vercel logs` carries no duration field, so the split between database time
   * and everything else is not observable from outside. These two spans make it
   * observable: `problems.page` is this component's whole server-side cost and
   * `problems.list` is the three catalog queries inside it. The difference is
   * session lookup plus compute; the gap between `problems.page` and the request
   * time in the logs list is cold start plus the edge-to-region hop.
   *
   * `timed` is the sanctioned writer (`server/lib/observability/logger.ts`); it
   * redacts unconditionally and logs on failure too, which matters because a
   * span that only reports success hides exactly the slow paths worth finding.
   */
  const { rows, nextCursor } = await timed('problems.page', async () => {
    const signedIn = await getCurrentUser();

    const filters = parseFilters({
      difficulty: params.difficulty,
      topic: params.topic,
      pattern: params.pattern,
      platform: params.platform,
      search: params.search,
      cursor: params.cursor,
      limit: 25,
    });

    const page = await timed('problems.list', () =>
      listProblems({ db: getDb(), filters, userId: signedIn?.id ?? null }),
    );

    return page;
  });

  const query = new URLSearchParams(
    Object.entries(params).flatMap(([key, value]) =>
      typeof value === 'string' && key !== 'cursor' ? [[key, value] as [string, string]] : [],
    ),
  );

  return (
    <>
      <PageHeader
        title="Problems"
        /*
          Describes the feature, not just the content policy.

          This read "Metadata and links only — solving happens on the original
          platform", which defends C1 correctly and was then read as "this app
          has no solve experience". It does: an editor, a server-authoritative
          timer, stuck markers and reflection are one click away. The old copy
          undersold the whole differentiator on the first page anyone lands on.
        */
        /*
          "never the problem text" stopped being true when original problems
          went live: those carry a statement that is ours. C1 still holds for
          external links, and the wording now says which is which rather than
          making one claim about both.
        */
        description="Solve on the original platform or in the built-in editor — Quadrantcode records how the solve went. External problems link out; original problems are ours."
      />

      <form className="mb-6 flex flex-wrap gap-2" method="get">
        <input
          aria-label="Search problems by title"
          className="min-w-48 flex-1 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
          defaultValue={typeof params.search === 'string' ? params.search : ''}
          name="search"
          placeholder="Search titles…"
          type="search"
        />
        <select
          aria-label="Filter by difficulty"
          className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
          defaultValue={typeof params.difficulty === 'string' ? params.difficulty : ''}
          name="difficulty"
        >
          <option value="">Any difficulty</option>
          <option value="easy">Easy</option>
          <option value="medium">Medium</option>
          <option value="hard">Hard</option>
        </select>
        <button
          className="rounded-[var(--radius)] bg-[var(--accent)] px-3 py-2 text-sm font-medium text-[var(--accent-foreground)]"
          type="submit"
        >
          Apply
        </button>
      </form>

      {rows.length === 0 ? (
        <EmptyState
          title="No problems match those filters"
          description="Try clearing the search or widening the difficulty."
        />
      ) : (
        <div className="overflow-x-auto rounded-[var(--radius)] border border-[var(--border)]">
          <table className="w-full border-collapse text-sm">
            <caption className="sr-only">Problem catalog</caption>
            <thead>
              <tr className="border-b border-[var(--border)] bg-[var(--surface)] text-left">
                <th className="w-10 px-3 py-2.5 font-medium" scope="col">
                  <span className="sr-only">Status</span>
                </th>
                <th className="px-3 py-2.5 font-medium" scope="col">
                  Title
                </th>
                <th className="px-3 py-2.5 font-medium" scope="col">
                  Difficulty
                </th>
                <th className="px-3 py-2.5 font-medium" scope="col">
                  Topics
                </th>
                <th className="px-3 py-2.5 font-medium" scope="col">
                  Source
                </th>
                <th className="px-3 py-2.5 text-right font-medium" scope="col">
                  Est.
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((problem) => (
                <tr
                  className="border-b border-[var(--border)] transition-colors last:border-0 hover:bg-[var(--surface)]"
                  key={problem.id}
                >
                  <td className="px-3 py-2.5">
                    <StatusMark status={problem.userStatus} />
                  </td>
                  <td className="px-3 py-2.5">
                    <Link
                      className="rounded-sm font-medium text-[var(--text-primary)] transition-colors hover:text-[var(--accent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
                      href={`/problems/${problem.slug}`}
                    >
                      {problem.title}
                    </Link>
                  </td>
                  <td className="px-3 py-2.5">
                    <DifficultyPill difficulty={problem.difficulty} />
                  </td>
                  <td className="px-3 py-2.5">
                    <span className="flex flex-wrap gap-1">
                      <TopicChips
                        topics={problem.tags
                          .filter((tag) => tag.tagType === 'topic')
                          .map((tag) => tag.tagValue)}
                      />
                    </span>
                  </td>
                  {/*
                    Already on the row and never rendered until now. For a
                    catalog that is 100% external links, "which site am I about
                    to be sent to" is the one thing a reader cannot infer from
                    the title.
                  */}
                  <td className="whitespace-nowrap px-3 py-2.5 text-[var(--text-muted)]">
                    {problem.sourceType === 'original' ? 'Original' : (problem.platform ?? '—')}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-[var(--text-muted)]">
                    {problem.estimatedMinutes}m
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {nextCursor ? (
        <Link
          className="mt-4 inline-block rounded-[var(--radius)] border border-[var(--border)] px-3 py-2 text-sm"
          href={`/problems?${query.toString()}${query.size > 0 ? '&' : ''}cursor=${encodeURIComponent(nextCursor)}`}
        >
          Next page
        </Link>
      ) : null}
    </>
  );
}
