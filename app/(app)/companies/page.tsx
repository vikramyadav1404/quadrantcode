import Link from 'next/link';
import { CompanyDisclaimer } from '@/components/companies/CompanyDisclaimer';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageHeader } from '@/components/ui/PageHeader';
import { getDb } from '@/server/db';
import { listCompanies } from '@/server/services/companies';

export const metadata = { title: 'Company preparation · Quadrantcode' };

export default async function CompaniesPage() {
  const directory = await listCompanies(getDb());
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-4 md:p-8">
      <PageHeader
        description="Original practice, moderated candidate reports, and evidence-aware mock assessments."
        eyebrow="Preparation directory"
        title="Company patterns, labelled honestly"
      />
      <CompanyDisclaimer />
      {directory.length === 0 ? (
        <EmptyState
          description="Run the native content importer after migrations to populate the directory."
          title="No companies imported yet"
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {directory.map((company) => (
            <Link
              className="group rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] p-5 transition hover:-translate-y-0.5 hover:border-[var(--accent)]"
              href={`/companies/${company.slug}`}
              key={company.id}
            >
              <h2 className="text-lg font-semibold group-hover:text-[var(--accent)]">
                {company.name}
              </h2>
              <p className="mt-2 line-clamp-3 text-sm leading-relaxed text-[var(--text-muted)]">
                {company.overview}
              </p>
              <p className="mt-4 text-xs text-[var(--text-muted)]">
                {company.problemCount} labelled problems · {company.paperCount} mocks
              </p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
