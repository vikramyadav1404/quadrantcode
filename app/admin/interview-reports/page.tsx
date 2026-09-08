import { PageHeader } from '@/components/ui/PageHeader';
import { getDb } from '@/server/db';
import { listModerationQueue } from '@/server/services/interview-reports';
import { moderateInterviewReportAction } from './actions';

export default async function InterviewReportModerationPage() {
  const reports = await listModerationQueue(getDb());
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 p-4 md:p-8">
      <PageHeader
        description="Nothing publishes automatically. Review the source context, independent wording, NDA safety, duplicates, and evidence level."
        title="Interview report moderation"
      />
      {reports.length === 0 ? (
        <p className="rounded border border-[var(--border)] p-5 text-sm text-[var(--text-muted)]">
          The moderation queue is empty.
        </p>
      ) : (
        reports.map((report) => (
          <article
            className="rounded-[var(--radius-lg)] border border-[var(--border)] p-5"
            key={report.id}
          >
            <div className="flex flex-wrap justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-wide text-[var(--accent)]">
                  {report.companyName} · {report.status.replaceAll('_', ' ')}
                </p>
                <h2 className="mt-1 font-semibold">{report.concept}</h2>
                <p className="text-xs text-[var(--text-muted)]">
                  {report.role} · {report.round} · {report.interviewYear} · group{' '}
                  {report.duplicateGroupKey}
                </p>
              </div>
              <span className="text-xs text-[var(--text-muted)]">
                {report.difficulty} · {report.topics.join(', ')}
              </span>
            </div>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <div>
                <h3 className="text-xs font-medium uppercase text-[var(--text-muted)]">
                  Recollection
                </h3>
                <p className="mt-1 whitespace-pre-wrap text-sm">{report.recollection}</p>
              </div>
              <div>
                <h3 className="text-xs font-medium uppercase text-[var(--text-muted)]">
                  Experience
                </h3>
                <p className="mt-1 whitespace-pre-wrap text-sm">{report.experience}</p>
              </div>
            </div>
            <form
              action={moderateInterviewReportAction}
              className="mt-5 grid gap-3 rounded bg-[var(--surface-raised)] p-4 md:grid-cols-3"
            >
              <input name="reportId" type="hidden" value={report.id} />
              <label className="text-xs">
                Decision
                <select
                  className="mt-1 w-full rounded border border-[var(--border)] bg-[var(--surface)] p-2"
                  name="toStatus"
                  required
                >
                  <option value="">Select…</option>
                  <option value="needs_changes">Needs changes</option>
                  <option value="approved">Approve</option>
                  <option value="rejected">Reject</option>
                  {report.status === 'approved' ? (
                    <option value="published">Publish</option>
                  ) : null}
                  <option value="archived">Archive</option>
                </select>
              </label>
              <label className="text-xs">
                Evidence assignment
                <select
                  className="mt-1 w-full rounded border border-[var(--border)] bg-[var(--surface)] p-2"
                  name="assignedEvidenceType"
                >
                  <option value="">None</option>
                  <option value="candidate_reported">Candidate reported</option>
                  <option value="frequently_reported">Frequently reported</option>
                  <option value="unverified">Unverified</option>
                </select>
              </label>
              <label className="text-xs">
                Duplicate group
                <input
                  className="mt-1 w-full rounded border border-[var(--border)] bg-[var(--surface)] p-2"
                  defaultValue={report.duplicateGroupKey ?? ''}
                  name="duplicateGroupKey"
                />
              </label>
              <label className="md:col-span-3 text-xs">
                Reason
                <textarea
                  className="mt-1 w-full rounded border border-[var(--border)] bg-[var(--surface)] p-2"
                  name="reason"
                  required
                  rows={2}
                />
              </label>
              <div className="md:col-span-3 flex flex-wrap gap-4 text-xs">
                <label>
                  <input className="mr-1" name="sourceReviewed" type="checkbox" />
                  Source reviewed
                </label>
                <label>
                  <input className="mr-1" name="originalityReviewed" type="checkbox" />
                  Originality reviewed
                </label>
                <label>
                  <input className="mr-1" name="ndaSafe" type="checkbox" />
                  NDA safe
                </label>
              </div>
              <button
                className="justify-self-start rounded bg-[var(--accent)] px-4 py-2 text-sm font-medium text-[var(--accent-foreground)]"
                type="submit"
              >
                Record decision
              </button>
            </form>
          </article>
        ))
      )}
    </div>
  );
}
