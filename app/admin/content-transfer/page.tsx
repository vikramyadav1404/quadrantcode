import Link from 'next/link';
import { PageHeader } from '@/components/ui/PageHeader';
import {
  importEvidenceCsvAction,
  importNativeJsonAction,
  importPaperJsonAction,
} from './actions';

const box =
  'min-h-44 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-3 font-mono text-xs';
const button =
  'rounded-[var(--radius)] bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white';
export default function ContentTransferPage() {
  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <PageHeader
        title="Bulk import and restricted export"
        description="Validated imports are idempotent. Public export omits protected assets; sensitive export requires admin authorization and explicit confirmation."
      />
      <div className="grid gap-5">
        <Transfer
          title="Native library JSON"
          description={
            'Object with exactly { batches: [...10 validated batches], companies: [...10 seeds] }.'
          }
          action={importNativeJsonAction}
        />
        <Transfer
          title="Assessment paper JSON"
          description="Validated 20-paper library object."
          action={importPaperJsonAction}
        />
        <Transfer
          title="Evidence CSV"
          description="Required columns: problemSlug, companySlug, evidenceType. Optional evidence metadata uses the admin evidence rules."
          action={importEvidenceCsvAction}
        />
      </div>
      <section className="mt-6 rounded-[var(--radius-lg)] border border-[var(--border)] p-5">
        <h2 className="font-semibold">Exports</h2>
        <div className="mt-3 flex flex-wrap gap-3">
          <Link className={button} href="/api/admin/native-export?format=json&scope=public">
            Public-safe JSON
          </Link>
          <Link className={button} href="/api/admin/native-export?format=csv&scope=public">
            Summary CSV
          </Link>
          <Link
            className="rounded-[var(--radius)] border border-[var(--danger)] px-4 py-2 text-sm text-[var(--danger)]"
            href="/api/admin/native-export?format=json&scope=sensitive&confirm=hidden-data"
          >
            Sensitive JSON (hidden tests/references)
          </Link>
        </div>
        <p className="mt-3 text-xs text-[var(--warning)]">
          Sensitive downloads contain hidden tests, expected outputs, wrappers, and references.
          Store them only in an authorized private location.
        </p>
      </section>
    </main>
  );
}
function Transfer({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action: (formData: FormData) => Promise<void>;
}) {
  return (
    <section className="rounded-[var(--radius-lg)] border border-[var(--border)] p-5">
      <h2 className="font-semibold">{title}</h2>
      <p className="mt-1 text-sm text-[var(--text-muted)]">{description}</p>
      <form action={action} className="mt-3 grid gap-3">
        <textarea className={box} name="source" required />
        <button className={button}>Validate and import</button>
      </form>
    </section>
  );
}
