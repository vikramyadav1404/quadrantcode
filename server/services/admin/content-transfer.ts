import { asc, eq, inArray } from 'drizzle-orm';
import { parse } from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';
import { z } from 'zod';
import type { Database } from '@/server/db';
import {
  companies,
  contentLicenses,
  editorials,
  problemCompanyEvidence,
  problemExamples,
  problemLanguageTemplates,
  problemTopics,
  problemVersions,
  problems,
  testCases,
  topics,
} from '@/server/db/schema';
import { recordAudit } from '@/server/lib/observability/audit';
import {
  assessmentPaperLibrarySchema,
  importAssessmentPaperLibrary,
} from '@/server/services/assessments';
import {
  importNativeProblemLibrary,
  nativeProblemBatchSchema,
} from '@/server/services/native-content';
import { createAdminEvidence } from './companies';

const companySeedSchema = z
  .array(
    z.object({
      slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
      name: z.string().min(2).max(120),
      overview: z.string().min(40).max(4_000),
    }),
  )
  .length(10);

const nativeTransferSchema = z.object({
  batches: z.array(nativeProblemBatchSchema).length(10),
  companies: companySeedSchema,
});

export async function importAdminNativeJson(db: Database, actorId: string, source: string) {
  assertSize(source, 12 * 1024 * 1024);
  const parsed = nativeTransferSchema.parse(JSON.parse(source));
  const result = await importNativeProblemLibrary(db, parsed.batches, parsed.companies);
  await recordAudit(db, {
    actorId,
    action: 'content.native_json_imported',
    target: 'native-library',
    after: result,
  });
  return result;
}

export async function importAdminPaperJson(db: Database, actorId: string, source: string) {
  assertSize(source, 2 * 1024 * 1024);
  const library = assessmentPaperLibrarySchema.parse(JSON.parse(source));
  const result = await importAssessmentPaperLibrary(db, library);
  await recordAudit(db, {
    actorId,
    action: 'content.paper_json_imported',
    target: 'assessment-paper-library',
    after: result,
  });
  return result;
}

export async function importAdminEvidenceCsv(
  db: Database,
  actorId: string,
  source: string,
): Promise<{ rows: number }> {
  assertSize(source, 1024 * 1024);
  const records = parse(source, {
    bom: true,
    columns: (headers: string[]) => headers.map((header) => header.trim()),
    skip_empty_lines: true,
    trim: true,
  }) as Record<string, string>[];
  if (records.length > 500) throw new Error('Evidence CSV is limited to 500 rows.');
  const required = ['problemSlug', 'companySlug', 'evidenceType'];
  for (const column of required) {
    if (!records[0] || !(column in records[0]))
      throw new Error(`Missing CSV column ${column}.`);
  }

  const inputs = records.map((row) => ({
    problemSlug: row.problemSlug,
    companySlug: row.companySlug,
    role: nullable(row.role),
    round: nullable(row.round),
    candidateLevel: nullable(row.candidateLevel),
    yearFrom: row.yearFrom ?? '',
    yearTo: row.yearTo ?? '',
    location: nullable(row.location),
    evidenceType: row.evidenceType,
    sourceUrl: nullable(row.sourceUrl),
    reportCount: row.reportCount || '0',
    confidenceScore: row.confidenceScore || '0',
    verificationStatus: row.verificationStatus || 'unverified',
    lastReviewedDate: nullable(row.lastReviewedDate),
  }));

  for (const input of inputs) await createAdminEvidence(db, actorId, input);
  await recordAudit(db, {
    actorId,
    action: 'content.evidence_csv_imported',
    target: 'company-evidence',
    after: { rows: inputs.length },
  });
  return { rows: inputs.length };
}

export async function buildNativeContentExport(db: Database, includeSensitive: boolean) {
  const roots = await db
    .select({ problem: problems, version: problemVersions, license: contentLicenses })
    .from(problems)
    .innerJoin(problemVersions, eq(problemVersions.problemId, problems.id))
    .innerJoin(contentLicenses, eq(contentLicenses.id, problemVersions.contentLicenseId))
    .where(eq(problems.sourceType, 'original'))
    .orderBy(asc(problems.slug));
  const currentRoots = roots.filter(
    (root) => root.version.version === root.problem.currentVersion,
  );
  const versionIds = currentRoots.map((root) => root.version.id);
  const problemIds = currentRoots.map((root) => root.problem.id);
  if (versionIds.length === 0)
    return { schemaVersion: 1, scope: includeSensitive ? 'sensitive' : 'public', problems: [] };

  const [examples, templates, tests, editorialRows, topicRows, evidenceRows] =
    await Promise.all([
      db
        .select()
        .from(problemExamples)
        .where(inArray(problemExamples.problemVersionId, versionIds))
        .orderBy(asc(problemExamples.ordinal)),
      db
        .select()
        .from(problemLanguageTemplates)
        .where(inArray(problemLanguageTemplates.problemVersionId, versionIds)),
      db
        .select()
        .from(testCases)
        .where(inArray(testCases.problemVersionId, versionIds))
        .orderBy(asc(testCases.ordinal)),
      db.select().from(editorials).where(inArray(editorials.problemVersionId, versionIds)),
      db
        .select({
          problemId: problemTopics.problemId,
          slug: topics.slug,
          primary: problemTopics.isPrimary,
        })
        .from(problemTopics)
        .innerJoin(topics, eq(topics.id, problemTopics.topicId))
        .where(inArray(problemTopics.problemId, problemIds)),
      db
        .select({ evidence: problemCompanyEvidence, companySlug: companies.slug })
        .from(problemCompanyEvidence)
        .innerJoin(companies, eq(companies.id, problemCompanyEvidence.companyId))
        .where(inArray(problemCompanyEvidence.problemId, problemIds)),
    ]);

  return {
    schemaVersion: 1,
    scope: includeSensitive ? 'sensitive' : 'public',
    generatedAt: new Date().toISOString(),
    problems: currentRoots.map(({ problem, version, license }) => ({
      slug: problem.slug,
      title: problem.title,
      difficulty: problem.difficulty,
      difficultyCalibration: problem.difficultyCalibration,
      estimatedMinutes: problem.estimatedMinutes,
      status: problem.status,
      version: version.version,
      story: version.story,
      statement: version.statement,
      inputFormat: version.inputFormat,
      outputFormat: version.outputFormat,
      functionContract: version.functionContract,
      constraints: version.constraints,
      hints: version.hints,
      timeLimitMs: version.timeLimitMs,
      memoryLimitKb: version.memoryLimitKb,
      topics: topicRows.filter((row) => row.problemId === problem.id),
      examples: examples
        .filter((row) => row.problemVersionId === version.id)
        .map(({ input, output, explanation, ordinal }) => ({
          ordinal,
          input,
          output,
          explanation,
        })),
      editorial: editorialRows.find((row) => row.problemVersionId === version.id) ?? null,
      languages: templates
        .filter((row) => row.problemVersionId === version.id)
        .map((template) => ({
          language: template.language,
          displayName: template.displayName,
          runtimeVersion: template.runtimeVersion,
          functionSignature: template.functionSignature,
          starterCode: template.starterCode,
          serialization: template.serialization,
          ...(includeSensitive
            ? {
                judge0LanguageId: template.judge0LanguageId,
                wrapperTemplate: template.wrapperTemplate,
                referenceSolution: template.referenceSolution,
                validationHash: template.validationHash,
              }
            : {}),
        })),
      testCases: tests
        .filter(
          (test) =>
            test.problemVersionId === version.id &&
            (includeSensitive || test.visibility !== 'hidden'),
        )
        .map((test) => ({
          ordinal: test.ordinal,
          visibility: test.visibility,
          coverage: test.coverage,
          input: test.input,
          expectedOutput: test.expectedOutput,
          explanation: test.explanation,
          isPerformance: test.isPerformance,
        })),
      companies: evidenceRows
        .filter((row) => row.evidence.problemId === problem.id)
        .map((row) => ({
          companySlug: row.companySlug,
          evidenceType: row.evidence.evidenceType,
          role: row.evidence.role,
          round: row.evidence.round,
          verificationStatus: row.evidence.verificationStatus,
          reportCount: row.evidence.reportCount,
          sourceUrl: row.evidence.sourceUrl,
        })),
      provenance: {
        provenance: license.provenance,
        licenseName: license.licenseName,
        licenseUrl: license.licenseUrl,
        author: license.author,
        independentlyCreated: license.independentlyCreated,
      },
    })),
  };
}

export async function buildNativeSummaryCsv(db: Database): Promise<string> {
  const exported = await buildNativeContentExport(db, false);
  return stringify(
    exported.problems.map((problem) => ({
      slug: problem.slug,
      title: problem.title,
      difficulty: problem.difficulty,
      status: problem.status,
      version: problem.version,
      topics: problem.topics.map((topic) => topic.slug).join(';'),
      visibleTests: problem.testCases.length,
    })),
    { header: true, bom: true, record_delimiter: 'windows' },
  );
}

function assertSize(source: string, maximum: number) {
  if (Buffer.byteLength(source, 'utf8') > maximum)
    throw new Error(`Import exceeds the ${maximum}-byte limit.`);
}

function nullable(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}
