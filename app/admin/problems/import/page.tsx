/**
 * Bulk import of external-link problems into the public catalog.
 *
 * Admin only: `app/admin/layout.tsx` refuses everyone else, and the API route
 * checks again. The work happens in `CatalogImportPanel`, in chunks.
 */
import Link from 'next/link';
import { PageHeader } from '@/components/ui/PageHeader';
import { CATALOG_IMPORT_LIMITS } from '@/server/services/ingest/limits';
import { CatalogImportPanel } from './CatalogImportPanel';

export default function CatalogImportPage() {
  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <PageHeader
        title="Bulk import problems"
        description="Add external-link problems to the public catalog from a CSV: a title, a link, a difficulty and topics. No statements, only links."
        actions={
          <Link className="text-sm underline" href="/admin/problems">
            Back to problems
          </Link>
        }
      />

      <CatalogImportPanel
        chunkRows={CATALOG_IMPORT_LIMITS.chunkRows}
        maxKb={CATALOG_IMPORT_LIMITS.maxBytes / 1024}
        maxRows={CATALOG_IMPORT_LIMITS.maxRows}
      />
    </main>
  );
}
