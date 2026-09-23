/**
 * Self-reported confidence — **declared once, here.**
 *
 * The same three values were written out four times: the `pgEnum` in
 * `server/db/schema/enums.ts`, and a `type Confidence = 'low' | 'medium' |
 * 'high'` in each of `session/lifecycle.ts`, `revision/ladder.ts` and
 * `reflection/reflection.ts`. Four declarations that have to agree, none of
 * which can see the others — the same shape `lib/reflection/taxonomy.ts` exists
 * to prevent (D21), and the same failure it describes: a value one layer offers
 * and another rejects.
 *
 * So the array below is the source, `pgEnum` is built from it, and the pickers
 * read their labels from it.
 *
 * It lives in `lib/` rather than `server/` because `components/` may not import
 * from `server/` — deny-by-default, F0.1 — and the confidence picker needs
 * these values. That rule is what surfaced the duplication: the picker could
 * not reach the type without either weakening the boundary or declaring the
 * values a fifth time.
 *
 * ## Order is meaningful
 *
 * Ascending. `scheduleAfterSolve` treats `'low'` and `'high'` as opposite ends —
 * `'low'` selects the compressed ladder, `'high'` is a precondition of the only
 * rule that lengthens a gap — so a picker that rendered them out of order would
 * read as the reverse of what it records.
 */
export const CONFIDENCE_LEVELS = ['low', 'medium', 'high'] as const;

export type Confidence = (typeof CONFIDENCE_LEVELS)[number];

/**
 * What the picker shows.
 *
 * Plain words rather than "Low/Medium/High": the question is how solid the
 * solution felt, and a bare scale invites a reflexive middle answer. `Skip` is
 * offered separately and sends `undefined` — never a rating standing in for
 * silence.
 */
export const CONFIDENCE_LABELS: Record<Confidence, string> = {
  low: 'Shaky',
  medium: 'OK',
  high: 'Solid',
};

export function isConfidence(value: unknown): value is Confidence {
  return typeof value === 'string' && (CONFIDENCE_LEVELS as readonly string[]).includes(value);
}
