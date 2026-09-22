import { createHash } from 'node:crypto';
import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { EXECUTION_LANGUAGES } from '@/lib/execution/languages';
import { TEST_CASE_COVERAGE, TEST_CASE_VISIBILITIES } from '@/lib/native/constants';
import type { Database, Transaction } from '@/server/db';
import {
  contentLicenses,
  editorials,
  problemCompanyEvidence,
  problemExamples,
  problemLanguageTemplates,
  problemVersions,
  problems,
  testCases,
} from '@/server/db/schema';
import { recordAudit } from '@/server/lib/observability/audit';
import { outputsMatch, wrapUserSource } from '@/server/services/execution/native';
import { EXECUTION_LIMITS, type ExecutionProvider } from '@/server/services/execution/provider';

const updateCoreSchema = z.object({
  problemId: z.string().uuid(),
  title: z.string().min(5).max(120),
  difficulty: z.enum(['easy', 'medium', 'hard']),
  difficultyCalibration: z.coerce.number().int().min(-2).max(2),
  estimatedMinutes: z.coerce.number().int().min(5).max(240),
  story: z.string().min(40).max(4_000),
  statement: z.string().min(80).max(20_000),
  inputFormat: z.string().min(20).max(4_000),
  outputFormat: z.string().min(20).max(4_000),
  constraints: z.string().transform(lines),
  hints: z.string().transform(lines),
  timeLimitMs: z.coerce.number().int().min(250).max(20_000),
  memoryLimitKb: z.coerce.number().int().min(16_384).max(1_048_576),
  reviewNotes: z.string().max(4_000),
});

const templateSchema = z.object({
  problemId: z.string().uuid(),
  language: z.enum(EXECUTION_LANGUAGES),
  displayName: z.string().min(1).max(100),
  functionSignature: z.string().min(3).max(1_000),
  starterCode: z.string().min(10).max(65_536),
  wrapperTemplate: z
    .string()
    .min(20)
    .max(65_536)
    .refine(
      (value) => value.split('/*__USER_CODE__*/').length === 2,
      'Wrapper must contain the user-code marker exactly once.',
    ),
  referenceSolution: z.string().min(10).max(65_536),
});

const testCaseSchema = z.object({
  problemId: z.string().uuid(),
  testCaseId: z.string().uuid(),
  visibility: z.enum(TEST_CASE_VISIBILITIES),
  coverage: z.enum(TEST_CASE_COVERAGE),
  input: z.string().max(65_536),
  expectedOutput: z.string().min(1).max(65_536),
  explanation: z.string().max(2_000),
  isPerformance: z.boolean(),
});

const exampleSchema = z.object({
  problemId: z.string().uuid(),
  exampleId: z.string().uuid(),
  input: z.string().max(8_192),
  output: z.string().min(1).max(8_192),
  explanation: z.string().min(20).max(3_000),
});

const editorialSchema = z.object({
  problemId: z.string().uuid(),
  editorialId: z.string().uuid(),
  overview: z.string().min(80).max(10_000),
  bruteForceApproach: z.string().min(40).max(10_000),
  optimalApproach: z.string().min(80).max(12_000),
  correctnessProof: z.string().min(80).max(12_000),
  timeComplexity: z.string().min(3).max(300),
  spaceComplexity: z.string().min(3).max(300),
});

type DbExecutor = Database | Transaction;

export async function getNativeProblemAdmin(db: Database, problemId: string) {
  const [problem] = await db
    .select()
    .from(problems)
    .where(and(eq(problems.id, problemId), eq(problems.sourceType, 'original')))
    .limit(1);
  if (!problem) return null;

  const [version] = await db
    .select({
      row: problemVersions,
      license: contentLicenses,
    })
    .from(problemVersions)
    .innerJoin(contentLicenses, eq(contentLicenses.id, problemVersions.contentLicenseId))
    .where(
      and(
        eq(problemVersions.problemId, problem.id),
        eq(problemVersions.version, problem.currentVersion),
      ),
    )
    .limit(1);
  if (!version) return null;

  const [examples, templates, tests, editorial, evidence] = await Promise.all([
    db
      .select()
      .from(problemExamples)
      .where(eq(problemExamples.problemVersionId, version.row.id))
      .orderBy(asc(problemExamples.ordinal)),
    db
      .select()
      .from(problemLanguageTemplates)
      .where(eq(problemLanguageTemplates.problemVersionId, version.row.id))
      .orderBy(asc(problemLanguageTemplates.language)),
    db
      .select()
      .from(testCases)
      .where(eq(testCases.problemVersionId, version.row.id))
      .orderBy(asc(testCases.ordinal)),
    db
      .select()
      .from(editorials)
      .where(eq(editorials.problemVersionId, version.row.id))
      .limit(1),
    db
      .select()
      .from(problemCompanyEvidence)
      .where(eq(problemCompanyEvidence.problemId, problem.id)),
  ]);

  return {
    problem,
    version: version.row,
    license: version.license,
    examples,
    templates,
    tests,
    editorial: editorial[0] ?? null,
    evidence,
  };
}

export async function updateNativeProblemCore(
  db: Database,
  actorId: string,
  rawInput: unknown,
): Promise<void> {
  const input = updateCoreSchema.parse(rawInput);
  if (input.constraints.length < 3 || input.hints.length < 2) {
    throw new Error('At least three constraints and two hints are required.');
  }

  await db.transaction(async (tx) => {
    const current = await currentVersion(tx, input.problemId);
    assertEditable(current.status);
    await tx
      .update(problems)
      .set({
        title: input.title,
        difficulty: input.difficulty,
        difficultyCalibration: input.difficultyCalibration,
        estimatedMinutes: input.estimatedMinutes,
        status: 'needs_review',
        statement: input.statement,
        inputFormat: input.inputFormat,
        outputFormat: input.outputFormat,
        constraintsText: input.constraints.join('\n'),
      })
      .where(eq(problems.id, input.problemId));
    await tx
      .update(problemVersions)
      .set({
        status: 'needs_review',
        story: input.story,
        statement: input.statement,
        inputFormat: input.inputFormat,
        outputFormat: input.outputFormat,
        constraints: input.constraints,
        hints: input.hints,
        timeLimitMs: input.timeLimitMs,
        memoryLimitKb: input.memoryLimitKb,
        reviewNotes: input.reviewNotes,
        referenceValidatedAt: null,
        referenceValidationProvider: null,
        referenceValidationSummary: null,
        reviewedBy: null,
        publishedAt: null,
        updatedAt: new Date(),
      })
      .where(eq(problemVersions.id, current.id));
    await clearTemplateValidation(tx, current.id);
    await recordAudit(tx, {
      actorId,
      action: 'problem.native_core_updated',
      target: `problem:${input.problemId}`,
      before: { status: current.status },
      after: { status: 'needs_review', difficultyCalibration: input.difficultyCalibration },
    });
  });
}

export async function updateNativeLanguageTemplate(
  db: Database,
  actorId: string,
  rawInput: unknown,
): Promise<void> {
  const input = templateSchema.parse(rawInput);
  await db.transaction(async (tx) => {
    const current = await currentVersion(tx, input.problemId);
    assertEditable(current.status);
    const [updated] = await tx
      .update(problemLanguageTemplates)
      .set({
        displayName: input.displayName,
        functionSignature: input.functionSignature,
        starterCode: input.starterCode,
        wrapperTemplate: input.wrapperTemplate,
        referenceSolution: input.referenceSolution,
        validationHash: null,
        lastValidatedAt: null,
        runtimeVersion: null,
        judge0LanguageId: null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(problemLanguageTemplates.problemVersionId, current.id),
          eq(problemLanguageTemplates.language, input.language),
        ),
      )
      .returning({ id: problemLanguageTemplates.id });
    if (!updated) throw new Error('Language template does not exist.');
    await invalidateReview(tx, input.problemId, current.id);
    await recordAudit(tx, {
      actorId,
      action: 'problem.language_template_updated',
      target: `problem:${input.problemId}:${input.language}`,
      after: { language: input.language, status: 'needs_review' },
    });
  });
}

export async function updateNativeTestCase(
  db: Database,
  actorId: string,
  rawInput: unknown,
): Promise<void> {
  const input = testCaseSchema.parse(rawInput);
  await db.transaction(async (tx) => {
    const current = await currentVersion(tx, input.problemId);
    assertEditable(current.status);
    const [updated] = await tx
      .update(testCases)
      .set({
        visibility: input.visibility,
        coverage: input.coverage,
        input: input.input,
        expectedOutput: input.expectedOutput,
        explanation: input.explanation || null,
        isPerformance: input.isPerformance,
        updatedAt: new Date(),
      })
      .where(
        and(eq(testCases.id, input.testCaseId), eq(testCases.problemVersionId, current.id)),
      )
      .returning({ id: testCases.id });
    if (!updated) throw new Error('Test case does not belong to this problem version.');
    await clearTemplateValidation(tx, current.id);
    await invalidateReview(tx, input.problemId, current.id);
    await recordAudit(tx, {
      actorId,
      action:
        input.visibility === 'hidden' ? 'problem.hidden_test_updated' : 'problem.test_updated',
      target: `problem:${input.problemId}:test:${input.testCaseId}`,
      after: { visibility: input.visibility, coverage: input.coverage },
    });
  });
}

export async function updateNativeExample(
  db: Database,
  actorId: string,
  rawInput: unknown,
): Promise<void> {
  const input = exampleSchema.parse(rawInput);
  await db.transaction(async (tx) => {
    const current = await currentVersion(tx, input.problemId);
    assertEditable(current.status);
    const [updated] = await tx
      .update(problemExamples)
      .set({
        input: input.input,
        output: input.output,
        explanation: input.explanation,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(problemExamples.id, input.exampleId),
          eq(problemExamples.problemVersionId, current.id),
        ),
      )
      .returning({ id: problemExamples.id });
    if (!updated) throw new Error('Example does not belong to this problem version.');
    await clearTemplateValidation(tx, current.id);
    await invalidateReview(tx, input.problemId, current.id);
    await recordAudit(tx, {
      actorId,
      action: 'problem.example_updated',
      target: `problem:${input.problemId}:example:${input.exampleId}`,
      after: { status: 'needs_review' },
    });
  });
}

export async function updateNativeEditorial(
  db: Database,
  actorId: string,
  rawInput: unknown,
): Promise<void> {
  const input = editorialSchema.parse(rawInput);
  await db.transaction(async (tx) => {
    const current = await currentVersion(tx, input.problemId);
    assertEditable(current.status);
    const [updated] = await tx
      .update(editorials)
      .set({
        overview: input.overview,
        bruteForceApproach: input.bruteForceApproach,
        optimalApproach: input.optimalApproach,
        correctnessProof: input.correctnessProof,
        timeComplexity: input.timeComplexity,
        spaceComplexity: input.spaceComplexity,
        updatedAt: new Date(),
      })
      .where(
        and(eq(editorials.id, input.editorialId), eq(editorials.problemVersionId, current.id)),
      )
      .returning({ id: editorials.id });
    if (!updated) throw new Error('Editorial does not belong to this problem version.');
    await invalidateReview(tx, input.problemId, current.id);
    await recordAudit(tx, {
      actorId,
      action: 'problem.editorial_updated',
      target: `problem:${input.problemId}:editorial`,
      after: { status: 'needs_review' },
    });
  });
}

export async function sendNativeProblemToReview(
  db: Database,
  actorId: string,
  problemId: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    const current = await currentVersion(tx, z.string().uuid().parse(problemId));
    if (!['draft', 'needs_review'].includes(current.status)) {
      throw new Error('Only draft or needs-review problems can enter review.');
    }
    await assertPublicationShape(tx, problemId, current.id, false);
    await tx
      .update(problemVersions)
      .set({ status: 'review', updatedAt: new Date() })
      .where(eq(problemVersions.id, current.id));
    await tx.update(problems).set({ status: 'review' }).where(eq(problems.id, problemId));
    await recordAudit(tx, {
      actorId,
      action: 'problem.review_requested',
      target: `problem:${problemId}`,
      before: { status: current.status },
      after: { status: 'review' },
    });
  });
}

export async function validateNativeProblemReferences(
  db: Database,
  actorId: string,
  problemId: string,
  provider: ExecutionProvider,
): Promise<void> {
  if (!provider.executes) throw new Error('A real external execution provider is required.');
  const current = await currentVersion(db, z.string().uuid().parse(problemId));
  if (current.status !== 'review')
    throw new Error('Problem must be in review before validation.');
  await assertPublicationShape(db, problemId, current.id, false);

  const [templates, tests] = await Promise.all([
    db
      .select()
      .from(problemLanguageTemplates)
      .where(eq(problemLanguageTemplates.problemVersionId, current.id)),
    db
      .select()
      .from(testCases)
      .where(eq(testCases.problemVersionId, current.id))
      .orderBy(asc(testCases.ordinal)),
  ]);
  const runtimeVersions: Record<string, string> = {};
  const validations: { id: string; hash: string; runtimeVersion: string }[] = [];
  for (const language of EXECUTION_LANGUAGES) {
    const template = templates.find((entry) => entry.language === language);
    if (!template) throw new Error(`Missing ${language} template.`);
    // `language` matters: Python needs its future imports hoisted so PEP 585
    // annotations survive 3.8. Omitting it here would validate a DIFFERENT
    // source from the one a user's submission runs through.
    const source = wrapUserSource(
      template.wrapperTemplate,
      template.referenceSolution,
      language,
    );
    const hash = createHash('sha256')
      .update(
        JSON.stringify({
          source,
          tests: tests.map((test) => [test.input, test.expectedOutput]),
        }),
      )
      .digest('hex');
    let runtimeVersion = '';
    for (const test of tests) {
      const result = await provider.execute({
        language,
        source,
        stdin: test.input,
        expectedOutput: null,
        limits: {
          cpuSeconds: Math.min(EXECUTION_LIMITS.cpuSeconds, current.timeLimitMs / 1_000),
          wallSeconds: Math.min(
            EXECUTION_LIMITS.wallSeconds,
            Math.ceil(current.timeLimitMs / 1_000) + 1,
          ),
          memoryKb: Math.min(EXECUTION_LIMITS.memoryKb, current.memoryLimitKb),
        },
      });
      if (result.verdict !== 'accepted' || !outputsMatch(result.stdout, test.expectedOutput)) {
        throw new Error(`${language} failed test ${test.ordinal} with ${result.verdict}.`);
      }
      runtimeVersion ||= result.compilerRuntimeVersion ?? 'provider did not report version';
    }
    runtimeVersions[language] = runtimeVersion;
    validations.push({ id: template.id, hash, runtimeVersion });
  }

  const validatedAt = new Date();
  await db.transaction(async (tx) => {
    for (const validation of validations) {
      await tx
        .update(problemLanguageTemplates)
        .set({
          validationHash: validation.hash,
          lastValidatedAt: validatedAt,
          runtimeVersion: validation.runtimeVersion,
          updatedAt: validatedAt,
        })
        .where(eq(problemLanguageTemplates.id, validation.id));
    }
    await tx
      .update(problemVersions)
      .set({
        status: 'tested',
        referenceValidatedAt: validatedAt,
        referenceValidationProvider: provider.name,
        referenceValidationSummary: {
          languages: [...EXECUTION_LANGUAGES],
          tests: tests.length,
          runtimeVersions,
        },
        reviewedBy: actorId,
        updatedAt: validatedAt,
      })
      .where(eq(problemVersions.id, current.id));
    await tx.update(problems).set({ status: 'tested' }).where(eq(problems.id, problemId));
    await recordAudit(tx, {
      actorId,
      action: 'problem.references_validated',
      target: `problem:${problemId}`,
      after: {
        provider: provider.name,
        languages: EXECUTION_LANGUAGES.length,
        tests: tests.length,
      },
    });
  });
}

export async function publishNativeProblem(
  db: Database,
  actorId: string,
  input: {
    problemId: string;
    originalityConfirmed: boolean;
    samplesConfirmed: boolean;
    constraintsConfirmed: boolean;
    evidenceConfirmed: boolean;
  },
): Promise<void> {
  const problemId = z.string().uuid().parse(input.problemId);
  if (
    !input.originalityConfirmed ||
    !input.samplesConfirmed ||
    !input.constraintsConfirmed ||
    !input.evidenceConfirmed
  ) {
    throw new Error('Every publication review confirmation is required.');
  }
  await db.transaction(async (tx) => {
    const current = await currentVersion(tx, problemId);
    if (current.status !== 'tested' || !current.referenceValidatedAt) {
      throw new Error('Real-provider reference validation must pass before publishing.');
    }
    await assertPublicationShape(tx, problemId, current.id, true);
    const now = new Date();
    await tx
      .update(problemVersions)
      .set({ status: 'published', publishedAt: now, reviewedBy: actorId, updatedAt: now })
      .where(eq(problemVersions.id, current.id));
    await tx.update(problems).set({ status: 'published' }).where(eq(problems.id, problemId));
    await recordAudit(tx, {
      actorId,
      action: 'problem.published',
      target: `problem:${problemId}`,
      before: { status: current.status },
      after: { status: 'published' },
    });
  });
}

async function currentVersion(db: DbExecutor, problemId: string) {
  const [row] = await db
    .select({
      id: problemVersions.id,
      status: problemVersions.status,
      timeLimitMs: problemVersions.timeLimitMs,
      memoryLimitKb: problemVersions.memoryLimitKb,
      referenceValidatedAt: problemVersions.referenceValidatedAt,
    })
    .from(problems)
    .innerJoin(
      problemVersions,
      and(
        eq(problemVersions.problemId, problems.id),
        eq(problemVersions.version, problems.currentVersion),
      ),
    )
    .where(and(eq(problems.id, problemId), eq(problems.sourceType, 'original')))
    .limit(1);
  if (!row) throw new Error('Native problem or current version was not found.');
  return row;
}

async function clearTemplateValidation(db: DbExecutor, versionId: string) {
  await db
    .update(problemLanguageTemplates)
    .set({
      validationHash: null,
      lastValidatedAt: null,
      runtimeVersion: null,
      updatedAt: new Date(),
    })
    .where(eq(problemLanguageTemplates.problemVersionId, versionId));
}

async function invalidateReview(db: DbExecutor, problemId: string, versionId: string) {
  await db
    .update(problemVersions)
    .set({
      status: 'needs_review',
      referenceValidatedAt: null,
      referenceValidationProvider: null,
      referenceValidationSummary: null,
      reviewedBy: null,
      publishedAt: null,
      updatedAt: new Date(),
    })
    .where(eq(problemVersions.id, versionId));
  await db.update(problems).set({ status: 'needs_review' }).where(eq(problems.id, problemId));
}

async function assertPublicationShape(
  db: DbExecutor,
  problemId: string,
  versionId: string,
  requireValidatedTemplates: boolean,
) {
  const [examples, templates, tests, editorial, licenseRows, evidence] = await Promise.all([
    db.select().from(problemExamples).where(eq(problemExamples.problemVersionId, versionId)),
    db
      .select()
      .from(problemLanguageTemplates)
      .where(eq(problemLanguageTemplates.problemVersionId, versionId)),
    db.select().from(testCases).where(eq(testCases.problemVersionId, versionId)),
    db.select().from(editorials).where(eq(editorials.problemVersionId, versionId)).limit(1),
    db
      .select({ independentlyCreated: contentLicenses.independentlyCreated })
      .from(problemVersions)
      .innerJoin(contentLicenses, eq(contentLicenses.id, problemVersions.contentLicenseId))
      .where(eq(problemVersions.id, versionId)),
    db
      .select()
      .from(problemCompanyEvidence)
      .where(eq(problemCompanyEvidence.problemId, problemId)),
  ]);
  if (examples.length < 2 || examples.some((example) => example.explanation.trim().length < 20))
    throw new Error('Two explained examples are required.');
  if (
    templates.length !== EXECUTION_LANGUAGES.length ||
    EXECUTION_LANGUAGES.some(
      (language) => !templates.some((template) => template.language === language),
    )
  )
    throw new Error('All five language templates are required.');
  if (
    requireValidatedTemplates &&
    templates.some((template) => !template.lastValidatedAt || !template.validationHash)
  )
    throw new Error('Every language template must have current validation evidence.');
  if (
    tests.filter((test) => test.visibility !== 'hidden').length < 2 ||
    tests.filter((test) => test.visibility === 'hidden').length < 3
  )
    throw new Error('At least two visible and three hidden tests are required.');
  for (const coverage of ['minimum', 'maximum', 'duplicates', 'adversarial'] as const) {
    if (!tests.some((test) => test.coverage === coverage))
      throw new Error(`Missing ${coverage} testcase coverage.`);
  }
  if (!editorial[0]?.optimalApproach || !editorial[0].correctnessProof)
    throw new Error('A complete editorial and correctness proof are required.');
  if (!licenseRows[0]?.independentlyCreated)
    throw new Error('Independent provenance metadata is required.');
  if (
    evidence.some(
      (item) =>
        (item.evidenceType === 'verified_pyq' || item.evidenceType === 'official_sample') &&
        (!item.sourceUrl || item.verificationStatus !== 'verified'),
    )
  )
    throw new Error('Verified evidence must have a reviewed source.');
}

function assertEditable(status: string) {
  if (status === 'published' || status === 'archived') {
    throw new Error(
      'Published or archived versions are immutable. Create a new version to edit.',
    );
  }
}

function lines(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}
