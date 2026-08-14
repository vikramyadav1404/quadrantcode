/**
 * F1.2 · /settings/import — bring a list in, take your data out.
 */
import type { Metadata } from 'next';
import { requireCurrentUser } from '@/server/services/auth/session';
import { ImportPanel } from './ImportPanel';

export const metadata: Metadata = { title: 'Import & export · TraceLoop' };

export default async function ImportPage() {
  // Inside the (app) group, so the layout has already answered "signed in?" and
  // "onboarded?". This call is for the id, not the gate.
  await requireCurrentUser();

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <header>
        <h1 className="text-xl font-semibold">Import &amp; export</h1>
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          Bring a list you already track, or take yours with you.
        </p>
      </header>

      <ImportPanel />

      <section className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-4">
        <h2 className="text-base font-semibold">Export</h2>
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          Downloads every problem you track, in the same format this page imports — so a file
          you export here can be re-imported without creating duplicates. Problems that have
          since been archived from the catalog are left out, because they would come back as new
          entries.
        </p>
        <a
          className="mt-3 inline-block rounded-[var(--radius)] border border-[var(--border)] px-3 py-2 text-sm"
          href="/api/ingest/export"
        >
          Download CSV
        </a>
      </section>
    </div>
  );
}
