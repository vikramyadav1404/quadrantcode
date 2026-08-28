'use client';

/**
 * Save the report as a PDF.
 *
 * `window.print()` and nothing else. The browser's own print-to-PDF is what
 * turns this page into a file, which is why the PDF and the HTML cannot
 * disagree — they are the same document.
 */
export function PrintButton() {
  return (
    <button
      className="rounded-[var(--radius)] border border-[var(--border)] px-3 py-1.5 text-sm"
      onClick={() => window.print()}
      type="button"
    >
      Save as PDF
    </button>
  );
}
