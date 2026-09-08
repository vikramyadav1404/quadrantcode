import { and, asc, eq, ne } from 'drizzle-orm';
import type { Database } from '@/server/db';
import {
  companies,
  editorials,
  problemCompanyEvidence,
  problemExamples,
  problemLanguageTemplates,
  problemTopics,
  problemVersions,
  topics,
} from '@/server/db/schema';
import type { ExecutionLanguage } from '@/lib/execution/languages';
import type { EvidenceType } from '@/lib/native/constants';

export type PublicNativeProblem = {
  story: string;
  inputFormat: string;
  outputFormat: string;
  constraints: string[];
  hints: string[];
  timeLimitMs: number;
  memoryLimitKb: number;
  functionContract: {
    className?: string;
    functionName: string;
    parameters: Array<{ name: string; type: string; description: string }>;
    returnType: string;
  };
  examples: Array<{ input: string; output: string; explanation: string }>;
  editorial: {
    overview: string;
    bruteForceApproach: string | null;
    optimalApproach: string;
    correctnessProof: string;
    timeComplexity: string;
    spaceComplexity: string;
  } | null;
  topics: string[];
  companies: Array<{ name: string; slug: string; evidenceType: EvidenceType }>;
  templates: Partial<
    Record<
      ExecutionLanguage,
      {
        displayName: string;
        runtimeVersion: string | null;
        functionSignature: string;
        starterCode: string;
      }
    >
  >;
};

/** Explicit allowlist: no test case, wrapper, Judge0 id, or reference solution is selected. */
export async function getPublicNativeProblem(
  db: Database,
  input: { problemId: string; version: number },
): Promise<PublicNativeProblem | null> {
  const [version] = await db
    .select({
      id: problemVersions.id,
      story: problemVersions.story,
      inputFormat: problemVersions.inputFormat,
      outputFormat: problemVersions.outputFormat,
      constraints: problemVersions.constraints,
      hints: problemVersions.hints,
      timeLimitMs: problemVersions.timeLimitMs,
      memoryLimitKb: problemVersions.memoryLimitKb,
      functionContract: problemVersions.functionContract,
    })
    .from(problemVersions)
    .where(
      and(
        eq(problemVersions.problemId, input.problemId),
        eq(problemVersions.version, input.version),
        eq(problemVersions.status, 'published'),
      ),
    )
    .limit(1);
  if (!version) return null;

  const [exampleRows, editorialRows, topicRows, companyRows, templateRows] = await Promise.all([
    db
      .select({
        input: problemExamples.input,
        output: problemExamples.output,
        explanation: problemExamples.explanation,
      })
      .from(problemExamples)
      .where(eq(problemExamples.problemVersionId, version.id))
      .orderBy(asc(problemExamples.ordinal)),
    db.select().from(editorials).where(eq(editorials.problemVersionId, version.id)).limit(1),
    db
      .select({ slug: topics.slug })
      .from(problemTopics)
      .innerJoin(topics, eq(topics.id, problemTopics.topicId))
      .where(eq(problemTopics.problemId, input.problemId)),
    db
      .select({
        name: companies.name,
        slug: companies.slug,
        evidenceType: problemCompanyEvidence.evidenceType,
      })
      .from(problemCompanyEvidence)
      .innerJoin(companies, eq(companies.id, problemCompanyEvidence.companyId))
      .where(
        and(
          eq(problemCompanyEvidence.problemId, input.problemId),
          ne(problemCompanyEvidence.verificationStatus, 'rejected'),
        ),
      ),
    db
      .select({
        language: problemLanguageTemplates.language,
        displayName: problemLanguageTemplates.displayName,
        runtimeVersion: problemLanguageTemplates.runtimeVersion,
        functionSignature: problemLanguageTemplates.functionSignature,
        starterCode: problemLanguageTemplates.starterCode,
      })
      .from(problemLanguageTemplates)
      .where(eq(problemLanguageTemplates.problemVersionId, version.id)),
  ]);

  const templates: PublicNativeProblem['templates'] = {};
  for (const template of templateRows) templates[template.language] = template;

  const editorial = editorialRows[0];
  return {
    story: version.story,
    inputFormat: version.inputFormat,
    outputFormat: version.outputFormat,
    constraints: version.constraints,
    hints: version.hints,
    timeLimitMs: version.timeLimitMs,
    memoryLimitKb: version.memoryLimitKb,
    functionContract: version.functionContract,
    examples: exampleRows,
    editorial: editorial
      ? {
          overview: editorial.overview,
          bruteForceApproach: editorial.bruteForceApproach,
          optimalApproach: editorial.optimalApproach,
          correctnessProof: editorial.correctnessProof,
          timeComplexity: editorial.timeComplexity,
          spaceComplexity: editorial.spaceComplexity,
        }
      : null,
    topics: topicRows.map((topic) => topic.slug),
    companies: companyRows,
    templates,
  };
}
