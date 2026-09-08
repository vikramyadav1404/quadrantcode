import { PageHeader } from '@/components/ui/PageHeader';
import { getDb } from '@/server/db';
import { listAdminCompanies, listAdminPapers } from '@/server/services/admin';
import {
  createPaperAction,
  publishPaperAction,
  reviewPaperAction,
  updatePaperAction,
} from './actions';

const field =
  'rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm';
const button =
  'rounded-[var(--radius)] bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50';

export default async function AdminPapersPage() {
  const [companies, papers] = await Promise.all([
    listAdminCompanies(getDb()),
    listAdminPapers(getDb()),
  ]);
  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <PageHeader
        title="Assessment paper builder"
        description="Build original pattern-based mocks. The workflow refuses publication until every native question is published."
      />
      <section className="rounded-[var(--radius-lg)] border border-[var(--border)] p-5">
        <h2 className="font-semibold">Create pattern-based mock</h2>
        <PaperForm action={createPaperAction} companies={companies} />
      </section>
      <section className="mt-8 grid gap-4">
        {papers.map((paper) => (
          <details
            className="rounded-[var(--radius-lg)] border border-[var(--border)] p-5"
            key={paper.id}
          >
            <summary className="cursor-pointer font-semibold">
              {paper.companyName} · {paper.title} · {paper.status}
            </summary>
            <PaperForm action={updatePaperAction} companies={companies} paper={paper} />
            <div className="mt-4 flex flex-wrap gap-3">
              <form action={reviewPaperAction}>
                <input name="paperId" type="hidden" value={paper.id} />
                <button
                  className={button}
                  disabled={!['draft', 'needs_review'].includes(paper.status)}
                >
                  Send to review
                </button>
              </form>
              <form action={publishPaperAction} className="flex items-center gap-2 text-sm">
                <input name="paperId" type="hidden" value={paper.id} />
                <label className="flex gap-2">
                  <input name="patternLabelConfirmed" type="checkbox" />
                  Confirmed: not official/PYQ
                </label>
                <button className={button} disabled={paper.status !== 'review'}>
                  Publish
                </button>
              </form>
            </div>
            <ol className="mt-4 list-decimal pl-5 text-sm">
              {paper.questions.map((question) => (
                <li key={`${paper.id}-${question.ordinal}`}>
                  {question.problemTitle} · {question.marks} marks
                </li>
              ))}
            </ol>
          </details>
        ))}
      </section>
    </main>
  );
}

function PaperForm({
  action,
  companies,
  paper,
}: {
  action: (formData: FormData) => Promise<void>;
  companies: Awaited<ReturnType<typeof listAdminCompanies>>;
  paper?: Awaited<ReturnType<typeof listAdminPapers>>[number];
}) {
  const immutable =
    paper?.status === 'published' ||
    paper?.status === 'archived' ||
    Number(paper?.attemptCount ?? 0) > 0;
  return (
    <form action={action} className="mt-4 grid gap-3 md:grid-cols-2">
      {paper ? <input name="paperId" type="hidden" value={paper.id} /> : null}
      <select
        className={field}
        defaultValue={paper?.companySlug}
        disabled={immutable}
        name="companySlug"
      >
        {companies
          .filter((company) => company.isActive)
          .map((company) => (
            <option key={company.id} value={company.slug}>
              {company.name}
            </option>
          ))}
      </select>
      <input
        className={field}
        defaultValue={paper?.slug}
        disabled={immutable}
        name="slug"
        placeholder="unique-paper-slug"
        required
      />
      <input
        className={field}
        defaultValue={paper?.title}
        disabled={immutable}
        name="title"
        placeholder="Original Pattern Mock"
        required
      />
      <input
        className={field}
        defaultValue={paper?.role}
        disabled={immutable}
        name="role"
        placeholder="Software Engineer"
        required
      />
      <input
        className={field}
        defaultValue={paper?.patternPeriod}
        disabled={immutable}
        name="patternPeriod"
        placeholder="Evergreen original practice"
        required
      />
      <input
        className={field}
        defaultValue={paper?.durationMinutes ?? 90}
        disabled={immutable}
        name="durationMinutes"
        type="number"
      />
      <textarea
        className={`${field} min-h-28 md:col-span-2`}
        defaultValue={paper?.instructions}
        disabled={immutable}
        name="instructions"
        placeholder="Independent mock disclaimer and instructions (80+ characters)"
      />
      <textarea
        className={`${field} min-h-28`}
        defaultValue={paper?.questions.map((question) => question.problemSlug).join('\n')}
        disabled={immutable}
        name="questionSlugs"
        placeholder="Ordered problem slugs, one per line"
      />
      <textarea
        className={`${field} min-h-28`}
        defaultValue={
          paper?.questions.map((question) => question.marks).join('\n') ?? '25\n25\n25\n25'
        }
        disabled={immutable}
        name="marks"
        placeholder="Marks, one per line; total 100"
      />
      <button className={`${button} md:col-span-2`} disabled={immutable}>
        {paper ? 'Save paper and return to needs review' : 'Create draft paper'}
      </button>
    </form>
  );
}
