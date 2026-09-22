import type { AssessmentPaperLibrary } from './content-schema';

/**
 * The rule tying the two content libraries together.
 *
 * A paper question names a problem by SLUG, and claims that problem belongs to
 * the paper's company. Neither half is enforced by a type or a foreign key —
 * the libraries are separate JSON files — so nothing stops a paper outliving
 * the problem it points at. That is exactly what happened when 84 duplicate
 * problems were retired on 2026-09-22: 76 of 80 questions went dangling and
 * every one of the twenty papers broke.
 *
 * Extracted from the test so the check is code rather than an assertion, and so
 * a fixture can prove it still fails on a dangling reference. With no active
 * papers the integrity test has nothing to walk, and a check that cannot be
 * shown to fail is indistinguishable from one that does nothing.
 */

export type ProblemForIntegrity = {
  slug: string;
  companies: readonly { companySlug: string; evidenceType: string }[];
};

export type PaperIntegrityProblem = {
  paperSlug: string;
  problemSlug: string;
  reason: 'missing-problem' | 'missing-company-association';
};

/** Every violation, rather than the first — a partial list invites a partial fix. */
export function findPaperIntegrityProblems(
  library: AssessmentPaperLibrary,
  problems: readonly ProblemForIntegrity[],
): PaperIntegrityProblem[] {
  const bySlug = new Map(problems.map((problem) => [problem.slug, problem]));
  const found: PaperIntegrityProblem[] = [];

  for (const paper of library.papers) {
    for (const question of paper.questions) {
      const problem = bySlug.get(question.problemSlug);

      if (!problem) {
        found.push({
          paperSlug: paper.slug,
          problemSlug: question.problemSlug,
          reason: 'missing-problem',
        });
        continue;
      }

      const claimed = problem.companies.some(
        (association) =>
          association.companySlug === paper.companySlug &&
          association.evidenceType === 'company_pattern',
      );

      if (!claimed) {
        found.push({
          paperSlug: paper.slug,
          problemSlug: question.problemSlug,
          reason: 'missing-company-association',
        });
      }
    }
  }

  return found;
}

export function assertPaperProblemIntegrity(
  library: AssessmentPaperLibrary,
  problems: readonly ProblemForIntegrity[],
): void {
  const found = findPaperIntegrityProblems(library, problems);
  if (found.length === 0) return;

  throw new Error(
    `${found.length} assessment paper question(s) do not match the active problem library:\n` +
      found
        .map((entry) => `  ${entry.paperSlug} -> ${entry.problemSlug} (${entry.reason})`)
        .join('\n'),
  );
}
