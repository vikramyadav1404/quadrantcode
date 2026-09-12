import Link from 'next/link';
import { notFound } from 'next/navigation';
import { CompanyDisclaimer } from '@/components/companies/CompanyDisclaimer';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageHeader } from '@/components/ui/PageHeader';
import { getDb } from '@/server/db';
import { listCompanyPapers } from '@/server/services/companies';

export default async function CompanyPapersPage({
  params,
}: {
  params: Promise<{ companySlug: string }>;
}) {
  const { companySlug } = await params;
  const data = await listCompanyPapers(getDb(), companySlug);
  if (!data) notFound();
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-4 md:p-8">
      <PageHeader
        description="Server-timed assessments built from original Quadrantcode problems."
        eyebrow="Pattern-based mocks"
        title={`${data.company.name} papers`}
      />
      <CompanyDisclaimer />
      {data.papers.length === 0 ? (
        <EmptyState
          description="Papers appear after content and execution validation."
          title="No published papers yet"
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {data.papers.map((paper) => (
            <Link
              className="rounded-[var(--radius-lg)] border border-[var(--border)] p-5 hover:border-[var(--accent)]"
              href={`/companies/${companySlug}/papers/${paper.slug}`}
              key={paper.slug}
            >
              <p className="text-xs uppercase tracking-wide text-[var(--accent)]">
                Pattern-Based Mock
              </p>
              <h2 className="mt-2 text-lg font-semibold">{paper.title}</h2>
              <p className="mt-2 text-sm text-[var(--text-muted)]">
                {paper.role} · {paper.patternPeriod}
              </p>
              <p className="mt-4 text-xs text-[var(--text-muted)]">
                {paper.durationMinutes} minutes · {paper.questionCount} questions
              </p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
