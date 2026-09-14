/**
 * A user's standing on one problem, as a mark.
 *
 * ## The word is never optional
 *
 * Colour and shape are never the only signal here — the rule `DifficultyPill`
 * follows and `npm run contrast` exists to hold. So the label always renders:
 * visibly when `showLabel` is set, `sr-only` otherwise. The glyph is
 * `aria-hidden` in both cases, because a screen reader announcing "◐" tells
 * nobody anything.
 *
 * ## Why it is a component and not a constant in one page
 *
 * This was a private `STATUS_MARK` map inside the catalog table. The solve
 * panel needs the same taxonomy, and two copies of a status vocabulary drift —
 * the symptom being a tick in the table and a dash on the problem's own page
 * for the same row, with nothing to catch it.
 */

export const STATUS_MARKS: Record<string, { glyph: string; token: string; label: string }> = {
  solved: { glyph: '✓', token: 'var(--success)', label: 'Solved' },
  attempted: { glyph: '◐', token: 'var(--warning)', label: 'Attempted' },
  stuck: { glyph: '!', token: 'var(--danger)', label: 'Got stuck' },
};

export function StatusMark({
  status,
  showLabel = false,
}: {
  status: string | null;
  /** Render the word visibly. Off in the catalog, where the column is a glyph wide. */
  showLabel?: boolean;
}) {
  const mark = STATUS_MARKS[status ?? ''];

  if (!mark) {
    return showLabel ? (
      <span className="text-[var(--text-muted)]">Not started</span>
    ) : (
      <span className="sr-only">Not started</span>
    );
  }

  return (
    <>
      <span aria-hidden="true" style={{ color: mark.token }}>
        {mark.glyph}
      </span>
      {showLabel ? (
        <span className="ml-1.5 font-medium" style={{ color: mark.token }}>
          {mark.label}
        </span>
      ) : (
        <span className="sr-only">{mark.label}</span>
      )}
    </>
  );
}
