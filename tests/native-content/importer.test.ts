import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { count } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { assessmentPapers, problemVersions, problems } from '@/server/db/schema';
import {
  importAssessmentPaperLibrary,
  RETIRED_PAPER_LIBRARY_PATH,
  loadAssessmentPaperLibrary,
} from '@/server/services/assessments';
import {
  NATIVE_PROBLEM_DATA_DIR,
  RETIRED_PROBLEM_DIR,
  importNativeProblemLibrary,
  loadNativeProblemBatches,
} from '@/server/services/native-content';

/** The 84 duplicates retired on 2026-09-22; still importable, just not active. */
const RETIRED_PROBLEM_BATCH_DIR = `${NATIVE_PROBLEM_DATA_DIR}/${RETIRED_PROBLEM_DIR}`;
import { buildNativeContentExport } from '@/server/services/admin';
import { type TestContext, hasTestDatabase, setupTestDb } from '../helpers/db';

const suite = hasTestDatabase ? describe : describe.skip;
const companiesSchema = z.array(
  z.object({ slug: z.string(), name: z.string(), overview: z.string() }),
);

suite('native library importer', () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await setupTestDb();
  }, 120_000);
  afterAll(async () => ctx?.close());

  it('imports the whole library and every paper idempotently', async () => {
    /*
     * ACTIVE AND RETIRED, both halves, deliberately.
     *
     * The subject here is that the importer is idempotent over a corpus, not
     * which part of that corpus is live. The retired paper library references
     * retired PROBLEMS, so importing the papers without those problems fails
     * with `Unknown original problem budget-match-counter` — importing only the
     * active sixteen while asking for all twenty papers is not a smaller test,
     * it is an inconsistent one.
     *
     * Dropping the paper half instead would quietly delete all coverage of
     * `importAssessmentPaperLibrary`, which still has to work the day a library
     * exists again.
     */
    const [activeBatches, retiredBatches, paperLibrary, companies] = await Promise.all([
      loadNativeProblemBatches(),
      loadNativeProblemBatches(RETIRED_PROBLEM_BATCH_DIR),
      loadAssessmentPaperLibrary(resolve(RETIRED_PAPER_LIBRARY_PATH)),
      readFile('data/companies.json', 'utf8').then((source) =>
        companiesSchema.parse(JSON.parse(source)),
      ),
    ]);

    /*
     * Counted from what was loaded rather than written as 100 and 20.
     *
     * Idempotency is the subject here: importing twice must create everything
     * once and change nothing the second time. The library's size was incidental
     * to that, and hard-coding it meant authoring one more problem would fail
     * this test for a reason unrelated to what it tests.
     */
    /*
     * Retired batches are renumbered before concatenating. Both directories
     * number their files from 1, so joining them raw trips the duplicate-batch
     * guard - which is that guard working, not an obstacle to route around.
     */
    const batches = [
      ...activeBatches,
      ...retiredBatches.map((batch, index) => ({
        ...batch,
        batch: activeBatches.length + index + 1,
      })),
    ];
    const problemTotal = batches.flatMap((batch) => batch.problems).length;
    if (paperLibrary === null)
      throw new Error('retired paper library should still be loadable');
    const paperTotal = paperLibrary.papers.length;
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
