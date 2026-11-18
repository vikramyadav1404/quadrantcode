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
 * The active library is now general mock OAs (no company) built from the
 * original problems. Fixtures below still prove the company-association check
 * FAILS when it should, so the rule cannot be gutted unnoticed while no company
 * papers exist.
 */
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  ACTIVE_PAPER_LIBRARY_PATH,
  RETIRED_PAPER_LIBRARY_PATH,
  type ProblemForIntegrity,
  assertPaperProblemIntegrity,
  assessmentPaperLibrarySchema,
  findPaperIntegrityProblems,
  loadAssessmentPaperLibrary,
} from '@/server/services/assessments';
import { loadNativeProblemBatches } from '@/server/services/native-content';
import type { AssessmentPaperLibrary } from '@/server/services/assessments';

describe('F4.5 · the active paper library', () => {
  it('holds only general mock OAs, each one easy, two medium, one hard', async () => {
    const [library, batches] = await Promise.all([
      loadAssessmentPaperLibrary(),
      loadNativeProblemBatches(),
    ]);
    expect(existsSync(ACTIVE_PAPER_LIBRARY_PATH)).toBe(true);
    expect(library).not.toBeNull();

    const problems = batches.flatMap((batch) => batch.problems);
    const bySlug = new Map(problems.map((problem) => [problem.slug, problem]));
    expect(library!.papers.length).toBeGreaterThan(0);

    for (const paper of library!.papers) {
      expect(paper.companySlug).toBeUndefined();
      expect(paper.paperType).toBe('pattern_based_mock');
      expect(paper.status).toBe('needs_review');
      expect(paper.questions.reduce((total, question) => total + question.marks, 0)).toBe(100);

      const picked = paper.questions.map((question) => bySlug.get(question.problemSlug)!);
      expect(picked.map((problem) => problem.difficulty)).toEqual([
        'easy',
        'medium',
        'medium',
        'hard',
      ]);
      expect(new Set(picked.map((problem) => problem.primaryTopic)).size).toBe(4);
    }

    assertPaperProblemIntegrity(library!, problems);
  });

  it('the retired library is kept, and none of its papers came back', async () => {
    // Retired means relocated: still on disk, and not what the loader reads.
    expect(existsSync(RETIRED_PAPER_LIBRARY_PATH)).toBe(true);
    const retired = JSON.parse(readFileSync(RETIRED_PAPER_LIBRARY_PATH, 'utf8')) as {
      papers: { slug: string }[];
    };
    const active = await loadAssessmentPaperLibrary();
    const activeSlugs = new Set(active!.papers.map((paper) => paper.slug));
    for (const paper of retired.papers) expect(activeSlugs.has(paper.slug)).toBe(false);
  });
});

/**
 * General papers name no company. The schema, not convention, enforces that,
 * and keeps any one problem to a single general paper.
 */
describe('F4.5 · general mock OA rules', () => {
  async function libraryWith(
    change: (papers: AssessmentPaperLibrary['papers']) => void,
  ): Promise<unknown> {
    const library = structuredClone(await loadAssessmentPaperLibrary())!;
    change(library.papers);
    return library;
  }

  it('accepts the generated library as it is', async () => {
    expect(assessmentPaperLibrarySchema.safeParse(await libraryWith(() => {})).success).toBe(
      true,
    );
  });

  it('REJECTS a general paper that names a company', async () => {
    const library = await libraryWith((papers) => {
      papers[0]!.title = 'Amazon Online Assessment Practice';
    });
    const result = assessmentPaperLibrarySchema.safeParse(library);
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toMatch(/must not name a company/);
  });

  it('REJECTS a problem used by two general papers', async () => {
    const library = await libraryWith((papers) => {
      papers[1]!.questions[0]!.problemSlug = papers[0]!.questions[0]!.problemSlug;
    });
    const result = assessmentPaperLibrarySchema.safeParse(library);
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toMatch(/already appears in another/);
  });

  it('a general paper needs no company association, but still needs the problem', () => {
    const general = {
      papers: [{ slug: 'general-fixture', questions: [{ problemSlug: 'no-company' }] }],
    } as unknown as AssessmentPaperLibrary;
    const problems: ProblemForIntegrity[] = [{ slug: 'no-company', companies: [] }];
    expect(findPaperIntegrityProblems(general, problems)).toEqual([]);
    expect(findPaperIntegrityProblems(general, [])[0]!.reason).toBe('missing-problem');
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
