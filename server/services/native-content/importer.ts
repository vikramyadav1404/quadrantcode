import { and, eq, sql } from 'drizzle-orm';
import type { Database, Transaction } from '@/server/db/client';
import {
  companies,
  contentLicenses,
  editorials,
  problemCompanyEvidence,
  problemExamples,
  problemLanguageTemplates,
  problemTags,
  problemTopics,
  problemVersions,
  problems,
  testCases,
  topics,
} from '@/server/db/schema';
import { EXECUTION_LANGUAGES } from '@/lib/execution/languages';
import type { NativeProblem, NativeProblemBatch } from './schema';
import { validateNativeLibrary } from './schema';

export type CompanySeed = { slug: string; name: string; overview: string };

export type NativeImportResult = {
  problems: number;
  versionsCreated: number;
  versionsUnchanged: number;
};

type DbExecutor = Database | Transaction;

async function upsertCompanies(db: DbExecutor, seeds: readonly CompanySeed[]) {
  const bySlug = new Map<string, string>();
  for (const company of seeds) {
    const [row] = await db
      .insert(companies)
      .values(company)
      .onConflictDoUpdate({
        target: companies.slug,
        set: { name: company.name, overview: company.overview, isActive: true },
      })
      .returning({ id: companies.id, slug: companies.slug });
    if (!row) throw new Error(`Could not upsert company ${company.slug}.`);
    bySlug.set(row.slug, row.id);
  }
  return bySlug;
}

async function importOne(
  db: DbExecutor,
  problem: NativeProblem,
  companyIds: ReadonlyMap<string, string>,
): Promise<'created' | 'unchanged'> {
  const [license] = await db
    .insert(contentLicenses)
    .values({
      provenance: problem.provenance.contentSource,
      licenseName: problem.provenance.licenseName,
      licenseUrl: problem.provenance.licenseUrl,
      author: problem.provenance.author,
      independentlyCreated: problem.provenance.independentlyCreated,
      reviewNotes: problem.provenance.note,
    })
    .onConflictDoUpdate({
      target: [contentLicenses.provenance, contentLicenses.licenseName, contentLicenses.author],
      set: {
        licenseUrl: problem.provenance.licenseUrl,
        independentlyCreated: true,
        reviewNotes: problem.provenance.note,
      },
    })
    .returning({ id: contentLicenses.id });
  if (!license) throw new Error(`Could not upsert content license for ${problem.slug}.`);

  const [problemRow] = await db
    .insert(problems)
    .values({
      slug: problem.slug,
      title: problem.title,
      sourceType: 'original',
      difficulty: problem.difficulty,
      estimatedMinutes: problem.estimatedMinutes,
      status: problem.status,
      difficultyCalibration: problem.difficultyCalibration,
      currentVersion: problem.version,
      statement: problem.statement,
      inputFormat: problem.inputFormat,
      outputFormat: problem.outputFormat,
      constraintsText: problem.constraints.join('\n'),
      examples: problem.examples,
      editorial: problem.editorial.overview,
    })
    .onConflictDoUpdate({
      target: problems.slug,
      set: {
        title: problem.title,
        difficulty: problem.difficulty,
        estimatedMinutes: problem.estimatedMinutes,
        difficultyCalibration: problem.difficultyCalibration,
        currentVersion: problem.version,
        statement: problem.statement,
        inputFormat: problem.inputFormat,
        outputFormat: problem.outputFormat,
        constraintsText: problem.constraints.join('\n'),
        examples: problem.examples,
        editorial: problem.editorial.overview,
      },
    })
    .returning({ id: problems.id });
  if (!problemRow) throw new Error(`Could not upsert problem ${problem.slug}.`);

  const [existingVersion] = await db
    .select({ id: problemVersions.id, statement: problemVersions.statement })
    .from(problemVersions)
    .where(
      and(
        eq(problemVersions.problemId, problemRow.id),
        eq(problemVersions.version, problem.version),
      ),
    )
    .limit(1);

  if (existingVersion && existingVersion.statement !== problem.statement) {
    throw new Error(
      `${problem.slug} version ${problem.version} changed. Bump the version instead of mutating history.`,
    );
  }

  let versionId = existingVersion?.id;
  let outcome: 'created' | 'unchanged' = 'unchanged';
  if (!versionId) {
    const [created] = await db
      .insert(problemVersions)
      .values({
        problemId: problemRow.id,
        version: problem.version,
        status: problem.status,
        problemType: problem.problemType,
        story: problem.story,
        statement: problem.statement,
        inputFormat: problem.inputFormat,
        outputFormat: problem.outputFormat,
        functionContract: problem.functionContract,
        constraints: problem.constraints,
        hints: problem.hints,
        timeLimitMs: problem.timeLimitMs,
        memoryLimitKb: problem.memoryLimitKb,
        contentLicenseId: license.id,
        provenance: problem.provenance.note,
        reviewNotes: 'Imported in NEEDS_REVIEW; publishing requires provider validation.',
      })
      .returning({ id: problemVersions.id });
    if (!created) throw new Error(`Could not create problem version for ${problem.slug}.`);
    versionId = created.id;
    outcome = 'created';
  }

  for (const [index, example] of problem.examples.entries()) {
    await db
      .insert(problemExamples)
      .values({ problemVersionId: versionId, ordinal: index + 1, ...example })
      .onConflictDoNothing();
  }

  await db
    .insert(editorials)
    .values({ problemVersionId: versionId, ...problem.editorial })
    .onConflictDoNothing();

  for (const [index, testCase] of problem.testCases.entries()) {
    await db
      .insert(testCases)
      .values({
        problemVersionId: versionId,
        ordinal: index + 1,
        visibility: testCase.visibility,
        coverage: testCase.coverage,
        input: testCase.input,
        expectedOutput: testCase.expectedOutput,
        explanation: testCase.explanation ?? null,
        isPerformance: testCase.isPerformance,
      })
      .onConflictDoNothing();
  }

  for (const language of EXECUTION_LANGUAGES) {
    const template = problem.languages[language];
    await db
      .insert(problemLanguageTemplates)
      .values({ problemVersionId: versionId, language, ...template })
      .onConflictDoNothing();
  }

  for (const topicSlug of problem.topics) {
    const [topic] = await db
      .insert(topics)
      .values({ slug: topicSlug, name: topicSlug.split('-').map(capitalize).join(' ') })
      .onConflictDoUpdate({ target: topics.slug, set: { slug: topicSlug } })
      .returning({ id: topics.id });
    if (!topic) throw new Error(`Could not upsert topic ${topicSlug}.`);
    await db
      .insert(problemTopics)
      .values({
        problemId: problemRow.id,
        topicId: topic.id,
        isPrimary: topicSlug === problem.primaryTopic,
      })
      .onConflictDoNothing();
    await db
      .insert(problemTags)
      .values({ problemId: problemRow.id, tagType: 'topic', tagValue: topicSlug })
      .onConflictDoNothing();
  }

  for (const association of problem.companies) {
    const companyId = companyIds.get(association.companySlug);
    if (!companyId) throw new Error(`Unknown company ${association.companySlug}.`);

    const [existingEvidence] = await db
      .select({ id: problemCompanyEvidence.id })
      .from(problemCompanyEvidence)
      .where(
        and(
          eq(problemCompanyEvidence.problemId, problemRow.id),
          eq(problemCompanyEvidence.companyId, companyId),
          eq(problemCompanyEvidence.evidenceType, association.evidenceType),
          sql`${problemCompanyEvidence.role} is not distinct from ${association.role}`,
          sql`${problemCompanyEvidence.round} is not distinct from ${association.round}`,
          sql`${problemCompanyEvidence.yearFrom} is not distinct from ${association.yearFrom}`,
        ),
      )
      .limit(1);

    if (!existingEvidence) {
      await db.insert(problemCompanyEvidence).values({
        problemId: problemRow.id,
        companyId,
        role: association.role,
        round: association.round,
        candidateLevel: association.candidateLevel,
        yearFrom: association.yearFrom,
        yearTo: association.yearTo,
        location: association.location,
        evidenceType: association.evidenceType,
        sourceUrl: association.sourceUrl,
        reportCount: association.reportCount,
        confidenceScore: association.confidenceScore,
        verificationStatus: association.verificationStatus,
        lastReviewedDate: association.lastReviewedDate,
      });
    }
  }

  return outcome;
}

export async function importNativeProblemLibrary(
  db: Database,
  batches: readonly NativeProblemBatch[],
  companySeeds: readonly CompanySeed[],
): Promise<NativeImportResult> {
  const summary = validateNativeLibrary(batches);

  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('quadrantcode-native-import'))`);
    const companyIds = await upsertCompanies(tx, companySeeds);
    let versionsCreated = 0;
    let versionsUnchanged = 0;

    for (const batch of [...batches].sort((left, right) => left.batch - right.batch)) {
      for (const problem of batch.problems) {
        const outcome = await importOne(tx, problem, companyIds);
        if (outcome === 'created') versionsCreated += 1;
        else versionsUnchanged += 1;
      }
    }

    return { problems: summary.total, versionsCreated, versionsUnchanged };
  });
}

function capitalize(value: string): string {
  return value.length === 0 ? value : `${value[0]!.toUpperCase()}${value.slice(1)}`;
}
