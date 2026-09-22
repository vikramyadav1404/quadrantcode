/**
 * Validate the ACTIVE assessment paper library against the active problems.
 *
 * Reports rather than throws when there is no active library: the papers were
 * retired on 2026-09-22 with the duplicate problems they referenced, and
 * "nothing to check" is a legitimate state, not a failure.
 */
import {
  ACTIVE_PAPER_LIBRARY_PATH,
  findPaperIntegrityProblems,
  loadAssessmentPaperLibrary,
} from '@/server/services/assessments';
import { loadNativeProblemBatches } from '@/server/services/native-content';

const [library, batches] = await Promise.all([
  loadAssessmentPaperLibrary(),
  loadNativeProblemBatches(),
]);

if (library === null) {
  console.log(
    JSON.stringify(
      {
        activePapers: 0,
        note: `No library at ${ACTIVE_PAPER_LIBRARY_PATH}; papers are retired.`,
      },
      null,
      2,
    ),
  );
} else {
  const problems = batches.flatMap((batch) => batch.problems);
  const found = findPaperIntegrityProblems(library, problems);

  if (found.length > 0) {
    console.error(`${found.length} paper question(s) do not match the active problem library:`);
    for (const entry of found) {
      console.error(`  ${entry.paperSlug} -> ${entry.problemSlug} (${entry.reason})`);
    }
    process.exit(1);
  }

  console.log(
    JSON.stringify(
      { activePapers: library.papers.length, questionsChecked: problems.length },
      null,
      2,
    ),
  );
}
