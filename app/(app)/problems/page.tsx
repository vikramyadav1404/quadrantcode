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
import { getDb } from '@/server/db';
import { listProblems, parseFilters } from '@/server/services/problems';
import { getCurrentUser } from '@/server/services/auth/session';

const DIFFICULTY_TONE: Record<string, string> = {
  easy: 'text-[var(--success)]',
  medium: 'text-[var(--warning)]',
  hard: 'text-[var(--danger)]',
};

export default async function ProblemsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const user = await getCurrentUser();

  const filters = parseFilters({
    difficulty: params.difficulty,
    topic: params.topic,
    pattern: params.pattern,
    platform: params.platform,
    search: params.search,
    cursor: params.cursor,
    limit: 25,
  });

  const { rows, nextCursor } = await listProblems({
    db: getDb(),
    filters,
    userId: user?.id ?? null,
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
        description="Metadata and links only — solving happens on the original platform."
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
                <th className="px-3 py-2 font-medium" scope="col">
                  Title
                </th>
                <th className="px-3 py-2 font-medium" scope="col">
                  Difficulty
                </th>
                <th className="px-3 py-2 font-medium" scope="col">
                  Topics
                </th>
                <th className="px-3 py-2 font-medium" scope="col">
                  Est.
                </th>
                <th className="px-3 py-2 font-medium" scope="col">
                  Your status
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((problem) => (
                <tr className="border-b border-[var(--border)] last:border-0" key={problem.id}>
                  <td className="px-3 py-2">
                    <Link
                      className="text-[var(--accent)] underline-offset-2 hover:underline"
                      href={`/problems/${problem.slug}`}
                    >
                      {problem.title}
                    </Link>
                  </td>
                  <td className={`px-3 py-2 ${DIFFICULTY_TONE[problem.difficulty] ?? ''}`}>
                    {problem.difficulty}
                  </td>
                  <td className="px-3 py-2 text-[var(--text-muted)]">
                    {problem.tags
                      .filter((tag) => tag.tagType === 'topic')
                      .map((tag) => tag.tagValue)
                      .join(', ') || '—'}
                  </td>
                  <td className="px-3 py-2 tabular-nums">{problem.estimatedMinutes}m</td>
                  <td className="px-3 py-2 text-[var(--text-muted)]">
                    {problem.userStatus ?? 'not started'}
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
