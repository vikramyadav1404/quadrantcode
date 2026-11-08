'use client';

/**
 * Choose a CSV → preview → confirm → chunks, one request each, with progress.
 *
 * The browser drives the chunks so no request runs long and nothing depends on
 * a background job surviving on serverless. If a chunk fails, "Try again"
 * resumes from that chunk; if the tab closes, choosing the same file again
 * skips everything already imported (the server keys every write on the link).
 */
import Link from 'next/link';
import { useState } from 'react';

type InvalidRow = { rowNumber: number; error: string; field: string | null };

type Preview = {
  totalRows: number;
  validCount: number;
  invalid: InvalidRow[];
  invalidCount: number;
  repeatedInFile: number;
  importable: number;
  toCreate: number;
  toPublish: number;
  alreadyInCatalog: number;
};

type Totals = { created: number; published: number; alreadyInCatalog: number };

type Run = {
  processed: number;
  total: number;
  totals: Totals;
  nextOffset: number | null;
  failedAt: number | null;
};

const card = 'rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-4';
const button =
  'rounded-[var(--radius)] bg-[var(--accent)] px-3 py-2 text-sm font-medium text-[var(--accent-foreground)] aria-disabled:opacity-60';

async function post(file: File, query: string): Promise<Record<string, unknown>> {
  const body = new FormData();
  body.set('file', file);
  const response = await fetch(`/api/admin/catalog-import?${query}`, { method: 'POST', body });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok || !payload || typeof payload !== 'object' || !('ok' in payload)) {
    throw new Error(
      (payload as { message?: string } | null)?.message ?? 'That request did not work.',
    );
  }
  return payload as Record<string, unknown>;
}

export function CatalogImportPanel({
  chunkRows,
  maxKb,
  maxRows,
}: {
  chunkRows: number;
  maxKb: number;
  maxRows: number;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [run, setRun] = useState<Run | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onChoose(chosen: File) {
    setFile(chosen);
    setPreview(null);
    setRun(null);
    setError(null);
    setBusy(true);
    try {
      setPreview((await post(chosen, 'preview=1')) as unknown as Preview);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'That file could not be read.');
    } finally {
      setBusy(false);
    }
  }

  /** Imports chunk after chunk from `start`, adding to `previous` totals. */
  async function importFrom(start: number, previous: Totals) {
    if (!file || !preview) return;
    setBusy(true);
    setError(null);

    let offset: number | null = start;
    const totals = { ...previous };
    setRun({
      processed: start,
      total: preview.importable,
      totals,
      nextOffset: start,
      failedAt: null,
    });

    while (offset !== null) {
      try {
        const result = await post(file, `offset=${offset}`);
        totals.created += Number(result['created'] ?? 0);
        totals.published += Number(result['published'] ?? 0);
        totals.alreadyInCatalog += Number(result['alreadyInCatalog'] ?? 0);
        offset = (result['nextOffset'] as number | null) ?? null;
        setRun({
          processed: Number(result['processed'] ?? 0),
          total: Number(result['total'] ?? preview.importable),
          totals: { ...totals },
          nextOffset: offset,
          failedAt: null,
        });
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'A chunk failed.');
        const failedAt = offset;
        setRun((current) =>
          current ? { ...current, failedAt, totals: { ...totals } } : current,
        );
        break;
      }
    }
    setBusy(false);
  }

  const percent = run && run.total > 0 ? Math.round((run.processed / run.total) * 100) : 0;
  const finished = run !== null && run.nextOffset === null && run.failedAt === null;

  return (
    <section className="mt-6 flex flex-col gap-4">
      <div className={card}>
        <label className="block text-sm font-medium" htmlFor="catalog-csv">
          CSV file
        </label>
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          Columns: <code>title</code>, <code>url</code>, <code>difficulty</code> (easy, medium
          or hard), <code>topic</code> (comma-separated) and optional <code>platform</code>. Up
          to {maxRows.toLocaleString('en-US')} rows and {maxKb.toLocaleString('en-US')} KB per
          file; split bigger lists. Imported {chunkRows} at a time.{' '}
          <a className="underline" download href="/catalog-import-template.csv">
            Download the template
          </a>
          .
        </p>
        <input
          accept=".csv,text/csv"
          className="mt-3 block w-full text-sm"
          disabled={busy}
          id="catalog-csv"
          onChange={(event) => {
            const chosen = event.target.files?.[0];
            if (chosen) void onChoose(chosen);
          }}
          type="file"
        />
      </div>

      {error ? (
        <p className={`${card} text-sm text-[var(--danger)]`} role="status">
          {error}
        </p>
      ) : null}

      {preview && !run ? (
        <div className={card}>
          <h2 className="text-base font-semibold">Preview</h2>
          <ul className="mt-2 grid gap-1 text-sm">
            <li>
              {preview.validCount.toLocaleString('en-US')} of{' '}
              {preview.totalRows.toLocaleString('en-US')} rows are valid
              {preview.invalidCount > 0
                ? `; ${preview.invalidCount.toLocaleString('en-US')} will be skipped`
                : ''}
              {preview.repeatedInFile > 0
                ? `; ${preview.repeatedInFile.toLocaleString('en-US')} repeat a link already in this file`
                : ''}
              .
            </li>
            <li>
              <strong>{preview.toCreate.toLocaleString('en-US')}</strong> new problems will be
              added and published.
            </li>
            {preview.toPublish > 0 ? (
              <li>
                {preview.toPublish.toLocaleString('en-US')} links are users&apos; private
                imports and will be published with this file&apos;s details.
              </li>
            ) : null}
            {preview.alreadyInCatalog > 0 ? (
              <li>
                {preview.alreadyInCatalog.toLocaleString('en-US')} are already in the catalog
                and will be left as they are.
              </li>
            ) : null}
          </ul>

          {preview.invalid.length > 0 ? (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[28rem] text-left text-sm">
                <caption className="sr-only">Rows that will be skipped, and why</caption>
                <thead>
                  <tr className="text-[var(--text-muted)]">
                    <th className="py-1 pr-4" scope="col">
                      Row
                    </th>
                    <th className="py-1 pr-4" scope="col">
                      Column
                    </th>
                    <th className="py-1" scope="col">
                      Problem
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {preview.invalid.map((row) => (
                    <tr className="border-t border-[var(--border)]" key={row.rowNumber}>
                      {/* +1: a spreadsheet counts the header as row 1. */}
                      <td className="py-1 pr-4">{row.rowNumber + 1}</td>
                      <td className="py-1 pr-4">{row.field ?? '—'}</td>
                      <td className="py-1">{row.error}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {preview.invalidCount > preview.invalid.length ? (
                <p className="mt-2 text-sm text-[var(--text-muted)]">
                  Showing the first {preview.invalid.length} of {preview.invalidCount}.
                </p>
              ) : null}
            </div>
          ) : null}

          <button
            aria-disabled={busy || preview.importable === 0}
            className={`mt-4 ${button}`}
            onClick={() => {
              if (busy || preview.importable === 0) return;
              void importFrom(0, { created: 0, published: 0, alreadyInCatalog: 0 });
            }}
            type="button"
          >
            {`Import ${preview.importable.toLocaleString('en-US')} problems`}
          </button>
        </div>
      ) : null}

      {run ? (
        <div aria-live="polite" className={card}>
          <h2 className="text-base font-semibold">{finished ? 'Imported' : 'Importing'}</h2>
          <div
            aria-label="Import progress"
            aria-valuemax={100}
            aria-valuemin={0}
            aria-valuenow={percent}
            className="mt-3 h-2 w-full overflow-hidden rounded-full bg-[var(--surface-raised)]"
            role="progressbar"
          >
            <div
              className="h-full bg-[var(--accent)] transition-[width]"
              style={{ width: `${percent}%` }}
            />
          </div>
          <p className="mt-2 text-sm text-[var(--text-muted)]">
            {run.processed.toLocaleString('en-US')} of {run.total.toLocaleString('en-US')}{' '}
            problems processed
          </p>
          <p className="mt-2 text-sm" data-testid="catalog-import-totals">
            {run.totals.created.toLocaleString('en-US')} added,{' '}
            {run.totals.published.toLocaleString('en-US')} published from private imports,{' '}
            {run.totals.alreadyInCatalog.toLocaleString('en-US')} already in the catalog.
          </p>

          {run.failedAt !== null ? (
            <button
              aria-disabled={busy}
              className={`mt-3 ${button}`}
              onClick={() => {
                if (busy || run.failedAt === null) return;
                void importFrom(run.failedAt, run.totals);
              }}
              type="button"
            >
              Try again from here
            </button>
          ) : null}

          {finished ? (
            <p className="mt-3 text-sm">
              Done.{' '}
              <Link className="underline" href="/problems">
                See the catalog
              </Link>
              .
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
