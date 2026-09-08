import { readFile } from 'node:fs/promises';
import { count } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { assessmentPapers, problemVersions, problems } from '@/server/db/schema';
import {
  importAssessmentPaperLibrary,
  loadAssessmentPaperLibrary,
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

suite('native library importer', () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await setupTestDb();
  }, 120_000);
  afterAll(async () => ctx?.close());

  it('imports 100 problems and 20 papers idempotently', async () => {
    const [batches, paperLibrary, companies] = await Promise.all([
      loadNativeProblemBatches(),
      loadAssessmentPaperLibrary(),
      readFile('data/companies.json', 'utf8').then((source) =>
        companiesSchema.parse(JSON.parse(source)),
      ),
    ]);
    const firstProblems = await importNativeProblemLibrary(ctx.db, batches, companies);
    const firstPapers = await importAssessmentPaperLibrary(ctx.db, paperLibrary);
    const secondProblems = await importNativeProblemLibrary(ctx.db, batches, companies);
    const secondPapers = await importAssessmentPaperLibrary(ctx.db, paperLibrary);

    expect(firstProblems).toEqual({
      problems: 100,
      versionsCreated: 100,
      versionsUnchanged: 0,
    });
    expect(firstPapers).toEqual({ papers: 20, papersCreated: 20, papersUnchanged: 0 });
    expect(secondProblems).toEqual({
      problems: 100,
      versionsCreated: 0,
      versionsUnchanged: 100,
    });
    expect(secondPapers).toEqual({ papers: 20, papersCreated: 0, papersUnchanged: 20 });

    const [[problemCount], [versionCount], [paperCount]] = await Promise.all([
      ctx.db.select({ value: count() }).from(problems),
      ctx.db.select({ value: count() }).from(problemVersions),
      ctx.db.select({ value: count() }).from(assessmentPapers),
    ]);
    expect(problemCount?.value).toBe(100);
    expect(versionCount?.value).toBe(100);
    expect(paperCount?.value).toBe(20);

    const publicExport = await buildNativeContentExport(ctx.db, false);
    expect(publicExport.problems).toHaveLength(100);
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
