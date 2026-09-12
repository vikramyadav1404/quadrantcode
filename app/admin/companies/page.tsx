import { PageHeader } from '@/components/ui/PageHeader';
import { CANDIDATE_LEVELS, EVIDENCE_TYPES } from '@/lib/native/constants';
import { getDb } from '@/server/db';
import { listAdminCompanies, listAdminEvidence } from '@/server/services/admin';
import { createEvidenceAction, updateCompanyAction } from './actions';

const field =
  'rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm';
const button =
  'rounded-[var(--radius)] bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white';

export default async function AdminCompaniesPage() {
  const [companies, evidence] = await Promise.all([
    listAdminCompanies(getDb()),
    listAdminEvidence(getDb()),
  ]);
  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <PageHeader
        title="Companies and evidence"
        description="Manage descriptive company pages and review evidence labels without fabricating provenance."
      />
      <section className="grid gap-4 md:grid-cols-2">
        {companies.map((company) => (
          <form
            action={updateCompanyAction}
            className="grid gap-3 rounded-[var(--radius-lg)] border border-[var(--border)] p-4"
            key={company.id}
          >
            <input name="companyId" type="hidden" value={company.id} />
            <input className={field} defaultValue={company.name} name="name" />
            <textarea
              className={`${field} min-h-28`}
              defaultValue={company.overview}
              name="overview"
            />
            <label className="flex gap-2 text-sm">
              <input defaultChecked={company.isActive} name="isActive" type="checkbox" />
              Active in public directory
            </label>
            <button className={button}>Save company</button>
          </form>
        ))}
      </section>
      <section className="mt-8 rounded-[var(--radius-lg)] border border-[var(--border)] p-5">
        <h2 className="text-lg font-semibold">Add reviewed evidence</h2>
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          Official/verified labels require a verified public source. Frequently reported
          requires at least three independent reports. Pattern labels cannot claim reports.
        </p>
        <form action={createEvidenceAction} className="mt-4 grid gap-3 md:grid-cols-3">
          <input className={field} name="problemSlug" placeholder="Problem slug" required />
          <select className={field} name="companySlug">
            {companies.map((company) => (
              <option key={company.id} value={company.slug}>
                {company.name}
              </option>
            ))}
          </select>
          <select className={field} name="evidenceType">
            {EVIDENCE_TYPES.map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
          <input className={field} name="role" placeholder="Role (optional)" />
          <input className={field} name="round" placeholder="Round (optional)" />
          <select className={field} name="candidateLevel">
            <option value="">Level (optional)</option>
            {CANDIDATE_LEVELS.map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
          <input className={field} name="yearFrom" placeholder="Year from" type="number" />
          <input className={field} name="yearTo" placeholder="Year to" type="number" />
          <input className={field} name="location" placeholder="Location (optional)" />
          <input
            className={field}
            name="sourceUrl"
            placeholder="Public source URL (when required)"
            type="url"
          />
          <input className={field} defaultValue={0} min={0} name="reportCount" type="number" />
          <input
            className={field}
            defaultValue={0}
            max={100}
            min={0}
            name="confidenceScore"
            type="number"
          />
          <select className={field} defaultValue="unverified" name="verificationStatus">
            {['unverified', 'reviewed', 'verified', 'rejected'].map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
          <input className={field} name="lastReviewedDate" type="date" />
          <button className={button}>Add evidence</button>
        </form>
      </section>
      <section className="mt-8">
        <h2 className="text-lg font-semibold">Recent evidence ({evidence.length})</h2>
        <div className="mt-3 overflow-x-auto rounded-[var(--radius)] border border-[var(--border)]">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-[var(--border)]">
                <th className="p-3">Company</th>
                <th className="p-3">Problem</th>
                <th className="p-3">Label</th>
                <th className="p-3">Verification</th>
                <th className="p-3">Reports</th>
                <th className="p-3">Source</th>
              </tr>
            </thead>
            <tbody>
              {evidence.map((item) => (
                <tr className="border-b border-[var(--border)]" key={item.id}>
                  <td className="p-3">{item.company}</td>
                  <td className="p-3">{item.problem}</td>
                  <td className="p-3">{item.evidenceType}</td>
                  <td className="p-3">{item.verificationStatus}</td>
                  <td className="p-3">{item.reportCount}</td>
                  <td className="p-3">
                    {item.sourceUrl ? (
                      <a
                        className="underline"
                        href={item.sourceUrl}
                        rel="noreferrer"
                        target="_blank"
                      >
                        Review
                      </a>
                    ) : (
                      '—'
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
