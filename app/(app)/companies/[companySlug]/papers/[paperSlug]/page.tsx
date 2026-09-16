import { notFound } from 'next/navigation';
import { CompanyDisclaimer } from '@/components/companies/CompanyDisclaimer';
import { DifficultyPill } from '@/components/solve/DifficultyPill';
import { PageHeader } from '@/components/ui/PageHeader';
import { getDb } from '@/server/db';
import { isFeatureEnabled } from '@/lib/flags';
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
      {/*
        The visible half of F4.5's flag. `startAssessmentAction` refuses
        regardless — this only keeps the page from offering a button that
        throws, which is the arrangement /settings/phone uses for
        FEATURE_PHONE_OTP.
      */}
      {isFeatureEnabled('FEATURE_MOCKS') ? (
        <form action={startAssessmentAction}>
          <input name="paperId" type="hidden" value={data.paper.id} />
          <button
            className="self-start rounded bg-[var(--accent)] px-5 py-2.5 font-medium text-[var(--accent-foreground)]"
            type="submit"
          >
            Start or resume assessment
          </button>
        </form>
      ) : (
        <p className="self-start rounded-[var(--radius)] border border-[var(--border)] px-3 py-2 text-sm text-[var(--text-muted)]">
          Timed assessments are turned off in this environment. The paper above is the real
          thing — you just cannot start a clock on it right now.
        </p>
      )}
    </div>
  );
}
