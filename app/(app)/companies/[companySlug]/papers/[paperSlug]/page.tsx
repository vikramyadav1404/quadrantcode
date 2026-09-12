import { notFound } from 'next/navigation';
import { CompanyDisclaimer } from '@/components/companies/CompanyDisclaimer';
import { DifficultyPill } from '@/components/solve/DifficultyPill';
import { PageHeader } from '@/components/ui/PageHeader';
import { getDb } from '@/server/db';
import { getCompanyPaper } from '@/server/services/companies';
import { startAssessmentAction } from './actions';

export default async function CompanyPaperPage({
  params,
}: {
  params: Promise<{ companySlug: string; paperSlug: string }>;
}) {
  const { companySlug, paperSlug } = await params;
  const data = await getCompanyPaper(getDb(), companySlug, paperSlug);
  if (!data) notFound();
  const totalMarks = data.questions.reduce((sum, question) => sum + question.marks, 0);
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 p-4 md:p-8">
      <PageHeader
        description={`${data.paper.role} · ${data.paper.patternPeriod}`}
        eyebrow={`${data.paper.durationMinutes} minutes · ${totalMarks} marks`}
        title={data.paper.title}
      />
      <CompanyDisclaimer />
      <section className="rounded-[var(--radius-lg)] border border-[var(--border)] p-5">
        <h2 className="font-semibold">Instructions</h2>
        <p className="mt-2 whitespace-pre-wrap text-sm text-[var(--text-muted)]">
          {data.paper.instructions}
        </p>
      </section>
      <section>
        <h2 className="mb-3 text-lg font-semibold">Questions</h2>
        <div className="divide-y divide-[var(--border)] rounded-[var(--radius-lg)] border border-[var(--border)]">
          {data.questions.map((question) => (
            <div className="flex items-center gap-3 p-4" key={question.id}>
              <span className="w-7 text-sm text-[var(--text-muted)]">{question.ordinal}.</span>
              <span className="min-w-0 flex-1 font-medium">{question.title}</span>
              <DifficultyPill difficulty={question.difficulty} />
              <span className="text-xs text-[var(--text-muted)]">{question.marks} marks</span>
            </div>
          ))}
        </div>
      </section>
      <form action={startAssessmentAction}>
        <input name="paperId" type="hidden" value={data.paper.id} />
        <button
          className="self-start rounded bg-[var(--accent)] px-5 py-2.5 font-medium text-[var(--accent-foreground)]"
          type="submit"
        >
          Start or resume assessment
        </button>
      </form>
    </div>
  );
}
