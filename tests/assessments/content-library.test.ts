/**
 * F4.5 · assessment papers against the active problem library.
 *
 * A paper question names a problem by SLUG and claims it belongs to the paper's
 * company. Nothing enforces either half — the two libraries are separate JSON
 * files with no foreign key — so a paper can outlive the problem it points at.
 *
 * That is not hypothetical. Retiring 84 duplicate problems on 2026-09-22 left
 * 76 of 80 questions dangling and broke all twenty papers, and this test is
 * what caught it. The papers were retired alongside; F4.5's library is deferred
 * until the shape work gives it more than sixteen problems to draw on.
 *
 * ## With no active papers, this must not pass vacuously
 *
 * There is nothing to walk today, so "every question is valid" is trivially
 * true. The guard is kept honest two ways: the absence is asserted explicitly
 * rather than assumed, and a fixture proves the check still FAILS on a dangling
 * reference and on a missing company association. If the rule were quietly
 * gutted, those fixtures would go green and this file would notice.
 */
import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  ACTIVE_PAPER_LIBRARY_PATH,
  RETIRED_PAPER_LIBRARY_PATH,
  type ProblemForIntegrity,
  assertPaperProblemIntegrity,
  findPaperIntegrityProblems,
  loadAssessmentPaperLibrary,
} from '@/server/services/assessments';
import { loadNativeProblemBatches } from '@/server/services/native-content';
import type { AssessmentPaperLibrary } from '@/server/services/assessments';

describe('F4.5 · the active paper library', () => {
  it('every question references an active problem with a matching company association', async () => {
    const [library, batches] = await Promise.all([
      loadAssessmentPaperLibrary(),
      loadNativeProblemBatches(),
    ]);

    if (library === null) {
      // The current state. Asserted, not assumed: if a library reappears this
      // branch stops running and the real check below takes over.
      expect(existsSync(ACTIVE_PAPER_LIBRARY_PATH)).toBe(false);
      return;
    }

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
    }

    assertPaperProblemIntegrity(
      library,
      batches.flatMap((batch) => batch.problems),
    );
  });

  it('the retired library is kept, and is not loaded', async () => {
    // Retired means relocated. Both halves matter: still on disk, still unread.
    expect(existsSync(RETIRED_PAPER_LIBRARY_PATH)).toBe(true);
    expect(await loadAssessmentPaperLibrary()).toBeNull();
  });
});

/**
 * The teeth. These run whether or not an active library exists.
 */
describe('F4.5 · the integrity check fails when it should', () => {
  const PROBLEMS: ProblemForIntegrity[] = [
    {
      slug: 'active-one',
      companies: [{ companySlug: 'amazon', evidenceType: 'company_pattern' }],
    },
    {
      slug: 'active-two',
      companies: [{ companySlug: 'google', evidenceType: 'verified_pyq' }],
    },
  ];

  function paperLibrary(problemSlug: string, companySlug = 'amazon'): AssessmentPaperLibrary {
    return {
      papers: [
        { slug: 'fixture-paper', companySlug, questions: [{ problemSlug, marks: 100 }] },
      ],
    } as unknown as AssessmentPaperLibrary;
  }

  it('accepts a question whose problem is active and carries the association', () => {
    expect(findPaperIntegrityProblems(paperLibrary('active-one'), PROBLEMS)).toEqual([]);
    expect(() =>
      assertPaperProblemIntegrity(paperLibrary('active-one'), PROBLEMS),
    ).not.toThrow();
  });

  it('REJECTS a question pointing at a problem that is not active', () => {
    // Exactly the failure that retiring the 84 produced.
    const found = findPaperIntegrityProblems(paperLibrary('retired-problem'), PROBLEMS);
    expect(found).toHaveLength(1);
    expect(found[0]!.reason).toBe('missing-problem');
    expect(() =>
      assertPaperProblemIntegrity(paperLibrary('retired-problem'), PROBLEMS),
    ).toThrow(/retired-problem/);
  });

  it('REJECTS a question whose problem does not claim that company', () => {
    const found = findPaperIntegrityProblems(paperLibrary('active-one', 'google'), PROBLEMS);
    expect(found).toHaveLength(1);
    expect(found[0]!.reason).toBe('missing-company-association');
  });

  it('REJECTS an association of the wrong evidence type', () => {
    // 'verified_pyq' is not 'company_pattern'. C3 cares which claim is made.
    const found = findPaperIntegrityProblems(paperLibrary('active-two', 'google'), PROBLEMS);
    expect(found).toHaveLength(1);
    expect(found[0]!.reason).toBe('missing-company-association');
  });

  it('reports EVERY violation, not just the first', () => {
    const library = {
      papers: [
        {
          slug: 'fixture-paper',
          companySlug: 'amazon',
          questions: [
            { problemSlug: 'gone-one', marks: 50 },
            { problemSlug: 'gone-two', marks: 50 },
          ],
        },
      ],
    } as unknown as AssessmentPaperLibrary;

    expect(findPaperIntegrityProblems(library, PROBLEMS)).toHaveLength(2);
  });
});
