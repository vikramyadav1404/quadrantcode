import { CompanyDisclaimer } from '@/components/companies/CompanyDisclaimer';
import { PageHeader } from '@/components/ui/PageHeader';
import { getDb } from '@/server/db';
import { listCompanies } from '@/server/services/companies';
import { ReportForm } from './ReportForm';

export default async function NewInterviewReportPage() {
  const companies = await listCompanies(getDb());
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-5 p-4 md:p-8">
      <PageHeader
        description="Candidate reports never publish automatically. A moderator reviews originality, source context, and NDA safety first."
        eyebrow="Community evidence"
        title="Share an interview recollection"
      />
      <CompanyDisclaimer />
      <ReportForm companies={companies.map(({ id, name }) => ({ id, name }))} />
    </div>
  );
}
