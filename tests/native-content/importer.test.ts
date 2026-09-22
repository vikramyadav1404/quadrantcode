import { readFile } from 'node:fs/promises';
import { count } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { assessmentPapers, problemVersions, problems } from '@/server/db/schema';
import {
  INITIAL_ASSESSMENT_COMPANY_SLUGS,
  type AssessmentPaperLibrary,
  assessmentPaperLibrarySchema,
  importAssessmentPaperLibrary,
} from '@/server/services/assessments';
import {
  importNativeProblemLibrary,
  loadNativeProblemBatches,
} from '@/server/services/native-content';
import { buildNativeContentExport } from '@/server/services/admin';
import { type TestContext, hasTestDatabase, setupTestDb } from '../helpers/db';

const suite = hasTestDatabase ? describe : describe.skip;
const companiesSchema = z.array(
  z.object({ slug: z.string(), name: z.string(), overview: z.string() }),
);

/**
 * The paper half used to import `data/retired/assessment-papers.json` against
 * the 84 retired problems, because the real papers reference retired slugs and
 * importing one half without the other throws `Unknown original problem`.
 *
 * That stopped working on 2026-09-22, when five of the ten retired batch files
 * were deleted for holding copied example inputs (D29): 40 of the 80 question
 * references now point at records that are not in the tree. Rather than drop
 * `importAssessmentPaperLibrary` coverage — it still has to work the day a real
 * library exists again — the papers are built here, against active slugs.
 *
 * Built, then parsed by the REAL `assessmentPaperLibrarySchema`. A fixture that
 * defines its own idea of a valid library tests the fixture; running it through
 * the shipped schema means the twenty-paper, two-per-company, hundred-mark
 * rules are the ones actually enforced in production, and a fixture that drifts
 * out of spec fails here instead of passing quietly.
 */
function buildPaperLibrary(problemSlugs: readonly string[]): AssessmentPaperLibrary {
  // Three questions per paper needs three DISTINCT slugs per paper; the schema
  // rejects a repeat within one paper. Sixteen slugs over twenty papers is
  // plenty as long as the window moves.
  expect(problemSlugs.length).toBeGreaterThanOrEqual(3);

  const papers = INITIAL_ASSESSMENT_COMPANY_SLUGS.flatMap((companySlug, companyIndex) =>
    [1, 2].map((paperNumber) => {
      const offset = (companyIndex * 2 + paperNumber) * 3;
      return {
        slug: `fixture-${companySlug}-paper-${paperNumber}`,
        title: `Fixture ${companySlug} pattern paper ${paperNumber}`,
        companySlug,
        role: 'Software Engineer',
        patternPeriod: '2024 to 2026 public patterns',
        paperType: 'pattern_based_mock' as const,
        durationMinutes: 90,
        instructions:
          'This is a fixture paper used only by the importer test. It exists to exercise ' +
          'importAssessmentPaperLibrary against a schema-valid library and is never served.',
        status: 'needs_review' as const,
        version: 1,
        provenance: {
          contentSource: 'quadrantcode-original' as const,
          independentlyCreated: true as const,
          licenseName: 'Quadrantcode Original Content',
          author: 'Quadrantcode',
          note: 'Fixture content authored for the importer test; not derived from any platform.',
        },
        questions: [34, 33, 33].map((marks, index) => ({
          problemSlug: problemSlugs[(offset + index) % problemSlugs.length]!,
          ordinal: index + 1,
          marks,
        })),
      };
    }),
  );

  return assessmentPaperLibrarySchema.parse({
    schemaVersion: 1,
    reviewStatus: 'needs_review',
    papers,
  });
}

suite('native library importer', () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await setupTestDb();
  }, 120_000);
  afterAll(async () => ctx?.close());

  it('imports the whole library and every paper idempotently', async () => {
    /*
     * THE ACTIVE LIBRARY ONLY.
     *
     * This used to import the retired corpus alongside it, for the reason given
     * above `buildPaperLibrary`. Five of the ten retired batch files are gone as
     * of 2026-09-22 and the remaining five no longer form a loadable library —
     * their batch numbers are 1, 2, 3, 6, 8, and `validateNativeLibrary` rejects
     * a gap. Renumbering them to close it would be editing retired content to
     * keep a test alive, which is backwards: the corpus was never the subject.
     *
     * What IS the subject — that importing twice creates everything once and
     * changes nothing the second time — is unaffected by corpus size. It runs
     * over sixteen problems now instead of a hundred.
     */
    const [batches, companies] = await Promise.all([
      loadNativeProblemBatches(),
      readFile('data/companies.json', 'utf8').then((source) =>
        companiesSchema.parse(JSON.parse(source)),
      ),
    ]);

    /*
     * Counted from what was loaded rather than written as 16 and 20.
     *
     * Idempotency is the subject here: importing twice must create everything
     * once and change nothing the second time. The library's size was incidental
     * to that, and hard-coding it meant authoring one more problem would fail
     * this test for a reason unrelated to what it tests.
     */
    const problemTotal = batches.flatMap((batch) => batch.problems).length;
    const paperLibrary = buildPaperLibrary(
      batches.flatMap((batch) => batch.problems.map((problem) => problem.slug)),
    );
    const paperTotal = paperLibrary.papers.length;

    /*
     * Counting from what was loaded has one failure mode: if the load returned
     * nothing, every `toBe(problemTotal)` below compares 0 to 0 and the whole
     * test passes having imported nothing. These two lines are what stop that.
     */
    expect(problemTotal).toBeGreaterThan(0);
    expect(paperTotal).toBe(20);
    const firstProblems = await importNativeProblemLibrary(ctx.db, batches, companies);
    const firstPapers = await importAssessmentPaperLibrary(ctx.db, paperLibrary);
    const secondProblems = await importNativeProblemLibrary(ctx.db, batches, companies);
    const secondPapers = await importAssessmentPaperLibrary(ctx.db, paperLibrary);

    expect(firstProblems).toEqual({
      problems: problemTotal,
      versionsCreated: problemTotal,
      versionsUnchanged: 0,
    });
    expect(firstPapers).toEqual({
      papers: paperTotal,
      papersCreated: paperTotal,
      papersUnchanged: 0,
    });
    expect(secondProblems).toEqual({
      problems: problemTotal,
      versionsCreated: 0,
      versionsUnchanged: problemTotal,
    });
    expect(secondPapers).toEqual({
      papers: paperTotal,
      papersCreated: 0,
      papersUnchanged: paperTotal,
    });

    const [[problemCount], [versionCount], [paperCount]] = await Promise.all([
      ctx.db.select({ value: count() }).from(problems),
      ctx.db.select({ value: count() }).from(problemVersions),
      ctx.db.select({ value: count() }).from(assessmentPapers),
    ]);
    expect(problemCount?.value).toBe(problemTotal);
    expect(versionCount?.value).toBe(problemTotal);
    expect(paperCount?.value).toBe(paperTotal);

    const publicExport = await buildNativeContentExport(ctx.db, false);
    expect(publicExport.problems).toHaveLength(problemTotal);
    expect(
      publicExport.problems.every((problem) =>
        problem.testCases.every((testCase) => testCase.visibility !== 'hidden'),
      ),
    ).toBe(true);
    expect(
      publicExport.problems.every((problem) =>
        problem.languages.every(
          (language) => !('wrapperTemplate' in language) && !('referenceSolution' in language),
        ),
      ),
    ).toBe(true);
  }, 120_000);
});
