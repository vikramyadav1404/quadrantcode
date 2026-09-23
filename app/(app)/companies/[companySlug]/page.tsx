import Link from 'next/link';
import { notFound } from 'next/navigation';
import { CompanyDisclaimer } from '@/components/companies/CompanyDisclaimer';
import { DifficultyPill } from '@/components/solve/DifficultyPill';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageHeader } from '@/components/ui/PageHeader';
import {
  PERMITTED_EVIDENCE_TYPES,
  EVIDENCE_TYPE_DESCRIPTIONS,
  EVIDENCE_TYPE_LABELS,
} from '@/lib/native/constants';
import { getDb } from '@/server/db';
import { getCompanyPageData } from '@/server/services/companies';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function CompanyPage({
  params,
  searchParams,
}: {
  params: Promise<{ companySlug: string }>;
  searchParams: SearchParams;
}) {
  const { companySlug } = await params;
  const query = await searchParams;
  const data = await getCompanyPageData(getDb(), companySlug, {
    role: first(query.role),
    round: first(query.round),
    year: first(query.year),
    difficulty: first(query.difficulty),
    topic: first(query.topic),
    evidence: first(query.evidence),
  });
  if (!data) notFound();

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 p-4 md:p-8">
      <PageHeader
        actions={
          <Link
            className="rounded border border-[var(--border)] px-3 py-2 text-sm"
            href="/companies/reports/new"
          >
            Share a report
          </Link>
        }
        description={data.company.overview}
        eyebrow="Evidence-aware preparation"
        title={data.company.name}
      />
      <CompanyDisclaimer />

      <form className="grid gap-3 rounded-[var(--radius-lg)] border border-[var(--border)] p-4 sm:grid-cols-2 lg:grid-cols-6">
        <FilterSelect
          label="Role"
          name="role"
          options={data.filterOptions.roles}
          value={data.filters.role}
        />
        <FilterSelect
          label="Round"
          name="round"
          options={data.filterOptions.rounds}
          value={data.filters.round}
        />
        <FilterSelect
          label="Year"
          name="year"
          options={data.filterOptions.years.map(String)}
          value={data.filters.year?.toString()}
        />
        <FilterSelect
          label="Difficulty"
          name="difficulty"
          options={['easy', 'medium', 'hard']}
          value={data.filters.difficulty}
        />
        <label className="text-xs text-[var(--text-muted)]">
          Evidence
          <select
            className="mt-1 w-full rounded border border-[var(--border)] bg-[var(--surface)] p-2 text-sm"
            defaultValue={data.filters.evidence ?? ''}
            name="evidence"
          >
            <option value="">All evidence</option>
            {/*
              PERMITTED_EVIDENCE_TYPES, not EVIDENCE_TYPES. The other four are
              blocked at the database (C3), so offering them here would be four
              filter options that can never match a row.
            */}
            {PERMITTED_EVIDENCE_TYPES.map((type) => (
              <option key={type} value={type}>
                {EVIDENCE_TYPE_LABELS[type]}
              </option>
            ))}
          </select>
        </label>
        <button
          className="self-end rounded bg-[var(--accent)] px-4 py-2 text-sm font-medium text-[var(--accent-foreground)]"
          type="submit"
        >
          Apply filters
        </button>
      </form>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(18rem,1fr)]">
        <section>
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold">Practice problems</h2>
            <Link
              className="text-sm text-[var(--accent)]"
              href={`/companies/${companySlug}/papers`}
            >
              View mock papers →
            </Link>
          </div>
          {data.problems.length === 0 ? (
            <EmptyState
              description="Try clearing one or more filters."
              title="No matching labelled problems"
            />
          ) : (
            <div className="divide-y divide-[var(--border)] rounded-[var(--radius-lg)] border border-[var(--border)]">
              {data.problems.map((problem) => (
                <Link
                  className="flex flex-wrap items-center gap-3 p-4 hover:bg-[var(--surface-raised)]"
                  href={`/problems/${problem.slug}/solve`}
                  key={`${problem.id}-${problem.evidenceType}`}
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{problem.title}</p>
                    <p className="mt-1 text-xs text-[var(--text-muted)]">
                      {problem.topics.join(' · ') || 'General DSA'}
                      {problem.role ? ` · ${problem.role}` : ''}
                      {problem.round ? ` · ${problem.round}` : ''}
                    </p>
                  </div>
                  <DifficultyPill difficulty={problem.difficulty} />
                  <span className="rounded-full border border-[var(--border)] px-2 py-1 text-xs">
                    {EVIDENCE_TYPE_LABELS[problem.evidenceType]}
                  </span>
                </Link>
              ))}
            </div>
          )}
        </section>

        <aside className="flex flex-col gap-5">
          <section className="rounded-[var(--radius-lg)] border border-[var(--border)] p-4">
            <h2 className="font-semibold">Topic frequency</h2>
            <p className="mt-1 text-xs text-[var(--text-muted)]">
              Counts only stored labelled evidence, including COMPANY_PATTERN rows.
            </p>
            <div className="mt-3 space-y-2">
              {data.topicInsights.map((topic) => (
                <div className="flex justify-between text-sm" key={topic.topic}>
                  <span>{topic.topic}</span>
                  <span className="text-[var(--text-muted)]">{topic.count}</span>
                </div>
              ))}
            </div>
          </section>
          <section className="rounded-[var(--radius-lg)] border border-[var(--border)] p-4">
            <h2 className="font-semibold">Evidence labels</h2>
            <div className="mt-3 space-y-3">
              {/*
                Same reason: a legend describing "Verified PYQ" is a claim this
                platform cannot currently make about anything.
              */}
              {PERMITTED_EVIDENCE_TYPES.map((type) => (
                <div key={type}>
                  <p className="text-xs font-medium">{EVIDENCE_TYPE_LABELS[type]}</p>
                  <p className="text-xs text-[var(--text-muted)]">
                    {EVIDENCE_TYPE_DESCRIPTIONS[type]}
                  </p>
                </div>
              ))}
            </div>
          </section>
        </aside>
      </div>

      <section>
        <h2 className="mb-3 text-lg font-semibold">
          Published candidate reports and experiences
        </h2>
        {data.reports.length === 0 ? (
          <EmptyState
            description="Submissions appear only after moderator approval and publication."
            title="No published candidate reports"
          />
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {data.reports.map((report, index) => (
              <article
                className="rounded-[var(--radius-lg)] border border-[var(--border)] p-4"
                key={`${report.id}-${index}`}
              >
                <p className="text-xs text-[var(--text-muted)]">
                  {report.role} · {report.round} · {report.interviewYear}
                  {report.location ? ` · ${report.location}` : ''}
                </p>
                {report.concept ? <h3 className="mt-2 font-medium">{report.concept}</h3> : null}
                {report.recollection ? (
                  <p className="mt-2 text-sm text-[var(--text-muted)]">{report.recollection}</p>
                ) : null}
                <p className="mt-3 text-sm">{report.experience}</p>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function FilterSelect({
  label,
  name,
  options,
  value,
}: {
  label: string;
  name: string;
  options: string[];
  value?: string;
}) {
  return (
    <label className="text-xs text-[var(--text-muted)]">
      {label}
      <select
        className="mt-1 w-full rounded border border-[var(--border)] bg-[var(--surface)] p-2 text-sm"
        defaultValue={value ?? ''}
        name={name}
      >
        <option value="">All</option>
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}
