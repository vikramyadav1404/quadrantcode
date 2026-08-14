/**
 * Admin catalog. Renders archived and unpublished rows, which the public list
 * hides — the /admin layout already enforces the role, so reaching this page
 * at all means the caller is an admin.
 */
import Link from 'next/link';
import { PageHeader } from '@/components/ui/PageHeader';
import { getDb } from '@/server/db';
import { listProblems, parseFilters } from '@/server/services/problems';
import { ProblemAdminRow } from './ProblemAdminRow';
import { NewProblemForm } from './NewProblemForm';

export default async function AdminProblemsPage() {
  const { rows } = await listProblems({
    db: getDb(),
    filters: parseFilters({ limit: 50, includeHidden: true }),
  });

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <PageHeader
        title="Problems"
        description="Create, edit and archive catalog entries. External-link problems store metadata and a link only."
      />

      <NewProblemForm />

      <h2 className="mt-10 mb-3 text-lg font-semibold">Catalog ({rows.length})</h2>
      <div className="overflow-x-auto rounded-[var(--radius)] border border-[var(--border)]">
        <table className="w-full border-collapse text-sm">
          <caption className="sr-only">All problems including archived</caption>
          <thead>
            <tr className="border-b border-[var(--border)] bg-[var(--surface)] text-left">
              <th className="px-3 py-2 font-medium" scope="col">
                Title
              </th>
              <th className="px-3 py-2 font-medium" scope="col">
                Source
              </th>
              <th className="px-3 py-2 font-medium" scope="col">
                Difficulty
              </th>
              <th className="px-3 py-2 font-medium" scope="col">
                Status
              </th>
              <th className="px-3 py-2 font-medium" scope="col">
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((problem) => (
              <ProblemAdminRow
                difficulty={problem.difficulty}
                id={problem.id}
                key={problem.id}
                slug={problem.slug}
                sourceType={problem.sourceType}
                status={problem.status}
                title={problem.title}
              />
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-6 text-xs text-[var(--text-muted)]">
        <Link className="underline" href="/problems">
          View the public catalog
        </Link>
      </p>
    </main>
  );
}
