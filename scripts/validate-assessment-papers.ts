import { loadAssessmentPaperLibrary } from '@/server/services/assessments';
import { loadNativeProblemBatches } from '@/server/services/native-content';

const [library, batches] = await Promise.all([
  loadAssessmentPaperLibrary(),
  loadNativeProblemBatches(),
]);
const problems = new Map(
  batches.flatMap((batch) => batch.problems).map((problem) => [problem.slug, problem]),
);

for (const paper of library.papers) {
  for (const question of paper.questions) {
    const problem = problems.get(question.problemSlug);
    if (!problem)
      throw new Error(`${paper.slug} references unknown problem ${question.problemSlug}.`);
    if (
      !problem.companies.some((association) => association.companySlug === paper.companySlug)
    ) {
      throw new Error(
        `${question.problemSlug} has no honest company-pattern association for ${paper.companySlug}.`,
      );
    }
  }
}

console.log(
  JSON.stringify(
    {
      total: library.papers.length,
      byCompany: Object.fromEntries(
        [...new Set(library.papers.map((paper) => paper.companySlug))].map((companySlug) => [
          companySlug,
          library.papers.filter((paper) => paper.companySlug === companySlug).length,
        ]),
      ),
    },
    null,
    2,
  ),
);
