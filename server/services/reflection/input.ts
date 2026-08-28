/**
 * What a client may send to the reflection layer.
 *
 * The taxonomy enums come from `lib/reflection/taxonomy.ts` — the same arrays
 * the Postgres enums are built from — so a category the form can offer is
 * exactly a category the database accepts. Writing the list again here is the
 * drift the ticket's "never re-declared" rule exists to prevent.
 *
 * As in F1.4, note what is absent: **no elapsed time**. A stuck marker's
 * elapsed seconds are computed server-side from the session's own event log, so
 * there is nothing here for a client to forge (D20).
 */
import { z } from 'zod';
import { MISTAKE_CATEGORIES, STUCK_CATEGORIES } from '@/lib/reflection/taxonomy';

/** The caps mirror the CHECK constraints, so a rejection is a message, not a 500. */
const NOTE_MAX = 2000;
const APPROACH_MAX = 4000;
const COMPLEXITY_MAX = 120;

export const markStuckSchema = z.object({
  sessionId: z.string().uuid(),
  category: z.enum(STUCK_CATEGORIES),
  note: z.string().trim().max(NOTE_MAX).optional(),
});

export const saveReflectionSchema = z.object({
  sessionId: z.string().uuid(),
  approach: z.string().trim().max(APPROACH_MAX).optional(),
  achievedComplexity: z.string().trim().max(COMPLEXITY_MAX).optional(),
  /**
   * Both multi-selects, and both may be empty.
   *
   * An empty `mistakes` is not the same as `['none']`: the first is a question
   * left alone, the second is "I solved it cleanly". F3.5 counts recurrence, so
   * conflating them would turn every skipped question into evidence of a clean
   * solve.
   */
  stuckAreas: z.array(z.enum(STUCK_CATEGORIES)).max(STUCK_CATEGORIES.length).default([]),
  mistakes: z.array(z.enum(MISTAKE_CATEGORIES)).max(MISTAKE_CATEGORIES.length).default([]),
  confidence: z.enum(['low', 'medium', 'high']).optional(),
});

export type MarkStuckInput = z.infer<typeof markStuckSchema>;
export type SaveReflectionInput = z.infer<typeof saveReflectionSchema>;
