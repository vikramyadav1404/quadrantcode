import { describe, expect, it } from 'vitest';
import { loadAssessmentPaperLibrary } from '@/server/services/assessments';
import { loadNativeProblemBatches } from '@/server/services/native-content';

describe('initial assessment paper library', () => {
  it('contains exactly two honest pattern-based mocks per company', async () => {
    const [library, batches] = await Promise.all([
      loadAssessmentPaperLibrary(),
      loadNativeProblemBatches(),
    ]);
    const problems = new Map(
      batches.flatMap((batch) => batch.problems).map((problem) => [problem.slug, problem]),
    );

    expect(library.papers).toHaveLength(20);
    for (const companySlug of new Set(library.papers.map((paper) => paper.companySlug))) {
      expect(library.papers.filter((paper) => paper.companySlug === companySlug)).toHaveLength(
        2,
      );
    }
    for (const paper of library.papers) {
      expect(paper.paperType).toBe('pattern_based_mock');
      expect(paper.status).toBe('needs_review');
      expect(paper.questions.reduce((total, question) => total + question.marks, 0)).toBe(100);
      for (const question of paper.questions) {
        expect(
          problems
            .get(question.problemSlug)
            ?.companies.some(
              (association) =>
                association.companySlug === paper.companySlug &&
                association.evidenceType === 'company_pattern',
            ),
        ).toBe(true);
      }
    }
  });
});
