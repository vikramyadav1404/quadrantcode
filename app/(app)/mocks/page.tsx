import Link from 'next/link';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageHeader } from '@/components/ui/PageHeader';
import { getDb } from '@/server/db';
import { listGeneralPapers } from '@/server/services/assessments';

export default async function MocksPage() {
  const papers = await listGeneralPapers(getDb());
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-4 md:p-8">
      <PageHeader
        description="Timed online-assessment practice built from original Quadrantcode problems. No paper is modelled on any employer."
        eyebrow="Mock OA"
        title="Mock online assessments"
      />
      {papers.length === 0 ? (
        <EmptyState
          description="Papers appear after content and execution validation."
          title="No published papers yet"
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {papers.map((paper) => (
            <Link
              className="rounded-[var(--radius-lg)] border border-[var(--border)] p-5 hover:border-[var(--accent)]"
              href={`/mocks/${paper.slug}`}
              key={paper.slug}
            >
              <p className="text-xs uppercase tracking-wide text-[var(--accent)]">Mock OA</p>
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
