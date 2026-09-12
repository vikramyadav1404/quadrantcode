'use client';

/**
 * Import a CSV: choose → preview → confirm → progress.
 *
 * The preview step is the point. Nothing is written until the user has seen
 * per-row verdicts for their own file, because "import 500 rows and tell them
 * afterwards" is not recoverable — there is no undo for 500 rows.
 *
 * Progress is polled from the server, never simulated. A client-side animation
 * that reaches 100% while the server is still working is the same class of lie
 * as the cooldown countdown in LoginForm that was never the cooldown (D14).
 */
import { useCallback, useEffect, useRef, useState } from 'react';

type InvalidRow = { rowNumber: number; error: string; field: string | null };

type Preview = {
  totalRows: number;
  validCount: number;
  invalid: InvalidRow[];
  invalidCount: number;
  willRunAsJob: boolean;
};

type Progress = {
  status: 'pending' | 'running' | 'succeeded' | 'partial' | 'failed' | 'stalled';
  totalRows: number;
  processedRows: number;
  createdCount: number;
  linkedCount: number;
  duplicateCount: number;
  invalidCount: number;
  error: string | null;
};

type Inline = { created: number; linked: number; duplicate: number; invalid: number };

const card = 'rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-4';

export function ImportPanel() {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [inline, setInline] = useState<Inline | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const jobId = useRef<string | null>(null);

  const reset = () => {
    setPreview(null);
    setProgress(null);
    setInline(null);
    setError(null);
    jobId.current = null;
  };

  async function send(target: File, previewOnly: boolean) {
    const body = new FormData();
    body.set('file', target);
    const response = await fetch(`/api/ingest/import${previewOnly ? '?preview=1' : ''}`, {
      method: 'POST',
      body,
    });
    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok || !payload || typeof payload !== 'object' || !('ok' in payload)) {
      throw new Error(
        (payload as { message?: string } | null)?.message ?? 'That upload did not work.',
      );
    }
    return payload as Record<string, unknown>;
  }

  const onChoose = useCallback(async (chosen: File) => {
    reset();
    setFile(chosen);
    setBusy(true);
    try {
      const result = await send(chosen, true);
      setPreview({
        totalRows: Number(result.totalRows),
        validCount: Number(result.validCount),
        invalid: (result.invalid as InvalidRow[]) ?? [],
        invalidCount: Number(result.invalidCount),
        willRunAsJob: Boolean(result.willRunAsJob),
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'That upload did not work.');
    } finally {
      setBusy(false);
    }
  }, []);

  const onConfirm = useCallback(async () => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const result = await send(file, false);
      if (result.mode === 'inline') {
        setInline({
          created: Number(result.created),
          linked: Number(result.linked),
          duplicate: Number(result.duplicate),
          invalid: Number(result.invalid),
        });
      } else {
        jobId.current = String(result.jobId);
        setProgress({
          status: 'pending',
          totalRows: Number(result.totalRows),
          processedRows: 0,
          createdCount: 0,
          linkedCount: 0,
          duplicateCount: 0,
          invalidCount: 0,
          error: null,
        });
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'That import did not start.');
    } finally {
      setBusy(false);
    }
  }, [file]);

  /*
   * Poll while a job is live.
   *
   * Every value shown comes from this response. The bar cannot reach 100% until
   * the server says `processed_rows` did.
   */
  useEffect(() => {
    const id = jobId.current;
    if (!id || !progress) return;
    if (['succeeded', 'partial', 'failed', 'stalled'].includes(progress.status)) return;

    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`/api/ingest/jobs/${id}`);
        if (!response.ok) return;
        const payload = (await response.json()) as Progress;
        setProgress(payload);
      } catch {
        // A dropped poll is not a failed import. The next tick retries, and the
        // job's own status is the truth either way.
      }
    }, 1000);

    return () => clearTimeout(timer);
  }, [progress]);

  const percent =
    progress && progress.totalRows > 0
      ? Math.round((progress.processedRows / progress.totalRows) * 100)
      : 0;

  return (
    <section className="flex flex-col gap-4">
      <div className={card}>
        <label className="block text-sm font-medium" htmlFor="csv">
          CSV file
        </label>
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          Columns: <code>title</code>, <code>platform</code>, <code>url</code>,{' '}
          <code>difficulty</code>, <code>topic</code>. <code>title</code> and <code>url</code>{' '}
          are required.
        </p>
        <input
          accept=".csv,text/csv"
          className="mt-3 block w-full text-sm"
          id="csv"
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

      {preview && !progress && !inline ? (
        <div className={card}>
          <h2 className="text-base font-semibold">Preview</h2>
          <p className="mt-1 text-sm text-[var(--text-muted)]">
            {preview.validCount} of {preview.totalRows} rows are ready to import.
            {preview.invalidCount > 0 ? ` ${preview.invalidCount} will be skipped.` : ''}
            {preview.willRunAsJob ? ' This runs in the background.' : ''}
          </p>

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
                      {/* +1: the user's spreadsheet counts the header as row 1. */}
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
            aria-disabled={busy || preview.validCount === 0}
            className="mt-4 rounded-[var(--radius)] bg-[var(--accent)] px-3 py-2 text-sm font-medium text-[var(--accent-foreground)] aria-disabled:opacity-60"
            onClick={() => {
              if (busy || preview.validCount === 0) return;
              void onConfirm();
            }}
            type="button"
          >
            {busy ? 'Starting…' : `Import ${preview.validCount} rows`}
          </button>
        </div>
      ) : null}

      {progress ? (
        <div aria-live="polite" className={card}>
          <h2 className="text-base font-semibold">Importing</h2>

          <div
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
            {progress.processedRows} of {progress.totalRows} rows · {progress.status}
          </p>

          {['succeeded', 'partial'].includes(progress.status) ? (
            <p className="mt-2 text-sm">
              {progress.createdCount} added, {progress.linkedCount} already in the catalog,{' '}
              {progress.duplicateCount} you already had
              {progress.invalidCount > 0 ? `, ${progress.invalidCount} skipped` : ''}.
            </p>
          ) : null}

          {progress.status === 'stalled' ? (
            <p className="mt-2 text-sm text-[var(--danger)]">
              This import stopped unexpectedly. Nothing was lost — re-upload the same file to
              continue from where it left off.
            </p>
          ) : null}

          {progress.status === 'failed' ? (
            <p className="mt-2 text-sm text-[var(--danger)]">
              {progress.error ?? 'This import failed.'}
            </p>
          ) : null}
        </div>
      ) : null}

      {inline ? (
        <div aria-live="polite" className={card}>
          <h2 className="text-base font-semibold">Imported</h2>
          <p className="mt-1 text-sm">
            {inline.created} added, {inline.linked} already in the catalog, {inline.duplicate}{' '}
            you already had
            {inline.invalid > 0 ? `, ${inline.invalid} skipped` : ''}.
          </p>
        </div>
      ) : null}
    </section>
  );
}
