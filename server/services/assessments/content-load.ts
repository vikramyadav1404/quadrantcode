import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { assessmentPaperLibrarySchema, type AssessmentPaperLibrary } from './content-schema';

/** Where the ACTIVE paper library lives. */
export const ACTIVE_PAPER_LIBRARY_PATH = 'data/assessment-papers.json';

/**
 * Where the retired one lives. Retired, not deleted: still in git, and its rows
 * were never imported — `assessment_papers` has always been empty in production.
 */
export const RETIRED_PAPER_LIBRARY_PATH = 'data/retired/assessment-papers.json';

/**
 * The active paper library, or `null` when there is none.
 *
 * The twenty company papers were retired on 2026-09-22 with the duplicate
 * problems they referenced. The active library now holds general mock OAs —
 * papers that name no company — built from the original problems; see
 * `scripts/generate-assessment-papers.ts`. `null` still means "no file", which
 * the validator reports rather than treats as a failure.
 */
export async function loadAssessmentPaperLibrary(
  filePath = resolve(ACTIVE_PAPER_LIBRARY_PATH),
): Promise<AssessmentPaperLibrary | null> {
  let raw: string;
  try {
    // turbopackIgnore (#29): only the CLI scripts call this; the app reaches it
    // through the `assessments` barrel, and tracing a runtime path pulls in the
    // whole project. See native-content/load.ts.
    raw = await readFile(/* turbopackIgnore: true */ filePath, 'utf8');
  } catch {
    return null;
  }
  return assessmentPaperLibrarySchema.parse(JSON.parse(raw));
}
