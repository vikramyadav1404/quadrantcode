import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { assessmentPaperLibrarySchema, type AssessmentPaperLibrary } from './content-schema';

/** Where an ACTIVE paper library would live. Absent today — see below. */
export const ACTIVE_PAPER_LIBRARY_PATH = 'data/assessment-papers.json';

/**
 * Where the retired one lives. Retired, not deleted: still in git, and its rows
 * were never imported — `assessment_papers` has always been empty in production.
 */
export const RETIRED_PAPER_LIBRARY_PATH = 'data/retired/assessment-papers.json';

/**
 * The active paper library, or `null` when there is none.
 *
 * ## Why this can be null
 *
 * The twenty papers referenced native problems BY SLUG, and 76 of their 80
 * questions pointed at problems retired on 2026-09-22 as duplicates — every one
 * of the twenty was affected. Twenty papers cannot be honestly rebuilt from the
 * sixteen problems that remain without becoming the same reskinning one level
 * up, so F4.5's library is deferred until the shape work gives it more to draw
 * on.
 *
 * `null` rather than an empty library: `assessmentPaperLibrarySchema` requires
 * exactly twenty papers, which is a real rule about a real library and is worth
 * keeping intact for whenever one exists again. Relaxing it to `.min(0)` so an
 * empty file could parse would weaken the guard permanently in order to express
 * a temporary absence.
 */
export async function loadAssessmentPaperLibrary(
  filePath = resolve(ACTIVE_PAPER_LIBRARY_PATH),
): Promise<AssessmentPaperLibrary | null> {
  let raw: string;
  try {
    raw = await readFile(filePath, 'utf8');
  } catch {
    return null;
  }
  return assessmentPaperLibrarySchema.parse(JSON.parse(raw));
}
