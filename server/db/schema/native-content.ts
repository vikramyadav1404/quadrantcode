/**
 * Normalized storage for Quadrantcode-native problems, evidence, moderation,
 * and server-timed assessments. Legacy external-link rows remain untouched.
 * Hidden tests, wrappers, and reference solutions are intentionally isolated
 * in server-only tables and must be selected explicitly by trusted services.
 */
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import {
  assessmentAttemptStatusEnum,
  assessmentPaperTypeEnum,
  candidateLevelEnum,
  difficultyEnum,
  evidenceTypeEnum,
  evidenceVerificationStatusEnum,
  executionLanguageEnum,
  executionVerdictEnum,
  moderationActionEnum,
  moderationStatusEnum,
  problemStatusEnum,
  problemTypeEnum,
  testCaseCoverageEnum,
  testCaseVisibilityEnum,
} from './enums';
import { executionJobs } from './execution';
import { problems } from './problems';
import { users } from './users';

export type FunctionParameter = {
  name: string;
  type: string;
  description: string;
};

export type FunctionContract = {
  className?: string;
  functionName: string;
  parameters: FunctionParameter[];
  returnType: string;
};

export type SerializationContract = {
  input: string;
  output: string;
  equality: 'exact_json';
};

export const contentLicenses = pgTable(
  'content_licenses',
  {
    id: uuid().primaryKey().defaultRandom(),
    provenance: text().notNull(),
    licenseName: text().notNull(),
    licenseUrl: text(),
    author: text().notNull().default('Quadrantcode editorial team'),
    independentlyCreated: boolean().notNull().default(true),
    reviewNotes: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('content_licenses_identity_key').on(
      table.provenance,
      table.licenseName,
      table.author,
    ),
    check('content_licenses_provenance_not_empty', sql`length(${table.provenance}) > 0`),
    check('content_licenses_name_not_empty', sql`length(${table.licenseName}) > 0`),
  ],
);

export const problemVersions = pgTable(
  'problem_versions',
  {
    id: uuid().primaryKey().defaultRandom(),
    problemId: uuid()
      .notNull()
      .references(() => problems.id, { onDelete: 'cascade' }),
    version: integer().notNull(),
    status: problemStatusEnum().notNull().default('draft'),
    problemType: problemTypeEnum().notNull().default('function'),
    story: text().notNull(),
    statement: text().notNull(),
    inputFormat: text().notNull(),
    outputFormat: text().notNull(),
    functionContract: jsonb().$type<FunctionContract>().notNull(),
    constraints: jsonb().$type<string[]>().notNull(),
    hints: jsonb().$type<string[]>().notNull(),
    timeLimitMs: integer().notNull(),
    memoryLimitKb: integer().notNull(),
    contentLicenseId: uuid()
      .notNull()
      .references(() => contentLicenses.id, { onDelete: 'restrict' }),
    provenance: text().notNull(),
    reviewNotes: text(),
    referenceValidatedAt: timestamp({ withTimezone: true }),
    referenceValidationProvider: text(),
    referenceValidationSummary: jsonb().$type<{
      languages: string[];
      tests: number;
      runtimeVersions: Record<string, string>;
    }>(),
    publishedAt: timestamp({ withTimezone: true }),
    createdBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    reviewedBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('problem_versions_problem_version_key').on(table.problemId, table.version),
    index('problem_versions_problem_status_idx').on(table.problemId, table.status),
    check('problem_versions_version_positive', sql`${table.version} > 0`),
    check('problem_versions_time_limit_positive', sql`${table.timeLimitMs} > 0`),
    check('problem_versions_memory_limit_positive', sql`${table.memoryLimitKb} > 0`),
    check('problem_versions_story_not_empty', sql`length(${table.story}) > 0`),
    check('problem_versions_statement_not_empty', sql`length(${table.statement}) > 0`),
    check(
      'problem_versions_publish_time_coherent',
      sql`(${table.status} = 'published' and ${table.publishedAt} is not null) or ${table.status} <> 'published'`,
    ),
  ],
);

export const topics = pgTable(
  'topics',
  {
    id: uuid().primaryKey().defaultRandom(),
    slug: text().notNull(),
    name: text().notNull(),
    description: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('topics_slug_key').on(table.slug),
    uniqueIndex('topics_name_key').on(table.name),
    check('topics_slug_normalised', sql`${table.slug} = lower(${table.slug})`),
  ],
);

export const problemTopics = pgTable(
  'problem_topics',
  {
    problemId: uuid()
      .notNull()
      .references(() => problems.id, { onDelete: 'cascade' }),
    topicId: uuid()
      .notNull()
      .references(() => topics.id, { onDelete: 'restrict' }),
    isPrimary: boolean().notNull().default(false),
  },
  (table) => [
    primaryKey({ columns: [table.problemId, table.topicId] }),
    index('problem_topics_topic_problem_idx').on(table.topicId, table.problemId),
  ],
);

export const problemExamples = pgTable(
  'problem_examples',
  {
    id: uuid().primaryKey().defaultRandom(),
    problemVersionId: uuid()
      .notNull()
      .references(() => problemVersions.id, { onDelete: 'cascade' }),
    ordinal: smallint().notNull(),
    input: text().notNull(),
    output: text().notNull(),
    explanation: text().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('problem_examples_version_ordinal_key').on(
      table.problemVersionId,
      table.ordinal,
    ),
    check('problem_examples_ordinal_positive', sql`${table.ordinal} > 0`),
    check('problem_examples_explanation_not_empty', sql`length(${table.explanation}) > 0`),
  ],
);

export const problemLanguageTemplates = pgTable(
  'problem_language_templates',
  {
    id: uuid().primaryKey().defaultRandom(),
    problemVersionId: uuid()
      .notNull()
      .references(() => problemVersions.id, { onDelete: 'cascade' }),
    language: executionLanguageEnum().notNull(),
    displayName: text().notNull(),
    runtimeVersion: text(),
    judge0LanguageId: integer(),
    functionSignature: text().notNull(),
    starterCode: text().notNull(),
    wrapperTemplate: text().notNull(),
    serialization: jsonb().$type<SerializationContract>().notNull(),
    referenceSolution: text().notNull(),
    validationHash: text(),
    lastValidatedAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('problem_language_templates_version_language_key').on(
      table.problemVersionId,
      table.language,
    ),
    index('problem_language_templates_judge0_idx').on(table.language, table.judge0LanguageId),
    check(
      'problem_language_templates_starter_not_empty',
      sql`length(${table.starterCode}) > 0`,
    ),
    check(
      'problem_language_templates_reference_not_empty',
      sql`length(${table.referenceSolution}) > 0`,
    ),
  ],
);

export const testCases = pgTable(
  'test_cases',
  {
    id: uuid().primaryKey().defaultRandom(),
    problemVersionId: uuid()
      .notNull()
      .references(() => problemVersions.id, { onDelete: 'cascade' }),
    ordinal: smallint().notNull(),
    visibility: testCaseVisibilityEnum().notNull(),
    coverage: testCaseCoverageEnum().notNull().default('typical'),
    input: text().notNull(),
    expectedOutput: text().notNull(),
    explanation: text(),
    weight: smallint().notNull().default(1),
    isPerformance: boolean().notNull().default(false),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('test_cases_version_ordinal_key').on(table.problemVersionId, table.ordinal),
    index('test_cases_version_visibility_idx').on(table.problemVersionId, table.visibility),
    check('test_cases_ordinal_positive', sql`${table.ordinal} > 0`),
    check('test_cases_weight_positive', sql`${table.weight} > 0`),
  ],
);

export const editorials = pgTable(
  'editorials',
  {
    id: uuid().primaryKey().defaultRandom(),
    problemVersionId: uuid()
      .notNull()
      .references(() => problemVersions.id, { onDelete: 'cascade' }),
    overview: text().notNull(),
    bruteForceApproach: text(),
    optimalApproach: text().notNull(),
    correctnessProof: text().notNull(),
    timeComplexity: text().notNull(),
    spaceComplexity: text().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('editorials_problem_version_key').on(table.problemVersionId),
    check('editorials_overview_not_empty', sql`length(${table.overview}) > 0`),
    check('editorials_optimal_not_empty', sql`length(${table.optimalApproach}) > 0`),
  ],
);

export const companies = pgTable(
  'companies',
  {
    id: uuid().primaryKey().defaultRandom(),
    slug: text().notNull(),
    name: text().notNull(),
    overview: text().notNull(),
    isActive: boolean().notNull().default(true),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('companies_slug_key').on(table.slug),
    uniqueIndex('companies_name_key').on(table.name),
    check('companies_slug_normalised', sql`${table.slug} = lower(${table.slug})`),
  ],
);

export const problemCompanyEvidence = pgTable(
  'problem_company_evidence',
  {
    id: uuid().primaryKey().defaultRandom(),
    problemId: uuid()
      .notNull()
      .references(() => problems.id, { onDelete: 'cascade' }),
    companyId: uuid()
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    role: text(),
    round: text(),
    candidateLevel: candidateLevelEnum(),
    yearFrom: smallint(),
    yearTo: smallint(),
    location: text(),
    evidenceType: evidenceTypeEnum().notNull().default('company_pattern'),
    sourceUrl: text(),
    reportCount: integer().notNull().default(0),
    confidenceScore: smallint().notNull().default(0),
    verificationStatus: evidenceVerificationStatusEnum().notNull().default('unverified'),
    lastReviewedDate: date(),
    createdBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('problem_company_evidence_identity_key').on(
      table.problemId,
      table.companyId,
      table.evidenceType,
      table.role,
      table.round,
      table.yearFrom,
    ),
    index('problem_company_evidence_company_filter_idx').on(
      table.companyId,
      table.evidenceType,
      table.verificationStatus,
    ),
    check(
      'problem_company_evidence_confidence_range',
      sql`${table.confidenceScore} between 0 and 100`,
    ),
    check('problem_company_evidence_report_count_non_negative', sql`${table.reportCount} >= 0`),
    check(
      'problem_company_evidence_year_range',
      sql`${table.yearFrom} is null or ${table.yearTo} is null or ${table.yearTo} >= ${table.yearFrom}`,
    ),
    check(
      'problem_company_evidence_verified_source',
      sql`${table.evidenceType} not in ('official_sample', 'verified_pyq') or (${table.sourceUrl} is not null and ${table.verificationStatus} = 'verified')`,
    ),
    check(
      'problem_company_evidence_frequent_threshold',
      sql`${table.evidenceType} <> 'frequently_reported' or ${table.reportCount} >= 3`,
    ),

    /*
     * C3, at the database, for company ASSOCIATIONS.
     *
     * The two checks above make a provenance claim well-formed - a
     * `verified_pyq` row must carry a source URL and a verified status. They do
     * not stop one being made, and were never meant to. Reading them as a C3
     * guard is the mistake `docs/c3-company-associations.md` exists to prevent.
     *
     * `problem_tags_company_style_suffix` does not cover this table either: it
     * constrains `problem_tags`. So until 2026-09-22 nothing prevented an admin
     * action from putting "Verified PYQ" on a problem, with no review workflow
     * behind the claim.
     *
     * Blocked rather than removed from the enum: dropping a `pgEnum` member is a
     * migration with real cost, whereas relaxing this CHECK is one line on the
     * day a review workflow exists. All 104 existing rows are `company_pattern`,
     * so this is a no-op against current data - which is exactly why the test
     * for it asserts a REJECTION rather than an accepted insert.
     */
    check(
      'problem_company_evidence_no_unreviewed_provenance',
      sql`${table.evidenceType} in ('company_pattern', 'unverified')`,
    ),
  ],
);

export const interviewReports = pgTable(
  'interview_reports',
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    companyId: uuid()
      .notNull()
      .references(() => companies.id, { onDelete: 'restrict' }),
    role: text().notNull(),
    candidateLevel: candidateLevelEnum().notNull(),
    interviewYear: smallint().notNull(),
    location: text(),
    round: text().notNull(),
    experience: text().notNull(),
    publicSourceUrl: text(),
    displayAnonymously: boolean().notNull().default(false),
    originalAndNdaSafe: boolean().notNull(),
    displayPermission: boolean().notNull(),
    status: moderationStatusEnum().notNull().default('draft'),
    duplicateGroupKey: text(),
    safetyFlags: jsonb().$type<string[]>().notNull().default([]),
    submittedAt: timestamp({ withTimezone: true }),
    publishedAt: timestamp({ withTimezone: true }),
    deletedAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('interview_reports_moderation_queue_idx').on(table.status, table.submittedAt),
    index('interview_reports_company_status_idx').on(table.companyId, table.status),
    check('interview_reports_role_not_empty', sql`length(${table.role}) > 0`),
    check('interview_reports_round_not_empty', sql`length(${table.round}) > 0`),
    check('interview_reports_experience_not_empty', sql`length(${table.experience}) > 0`),
    check(
      'interview_reports_publish_consent',
      sql`${table.status} <> 'published' or (${table.originalAndNdaSafe} and ${table.displayPermission} and ${table.publishedAt} is not null)`,
    ),
  ],
);

export const interviewReportQuestions = pgTable(
  'interview_report_questions',
  {
    id: uuid().primaryKey().defaultRandom(),
    reportId: uuid()
      .notNull()
      .references(() => interviewReports.id, { onDelete: 'cascade' }),
    ordinal: smallint().notNull(),
    concept: text().notNull(),
    recollection: text().notNull(),
    difficulty: difficultyEnum().notNull(),
    topicSlugs: jsonb().$type<string[]>().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('interview_report_questions_report_ordinal_key').on(
      table.reportId,
      table.ordinal,
    ),
    check('interview_report_questions_ordinal_positive', sql`${table.ordinal} > 0`),
    check('interview_report_questions_concept_not_empty', sql`length(${table.concept}) > 0`),
    check(
      'interview_report_questions_recollection_not_empty',
      sql`length(${table.recollection}) > 0`,
    ),
  ],
);

export const moderationDecisions = pgTable(
  'moderation_decisions',
  {
    id: uuid().primaryKey().defaultRandom(),
    reportId: uuid()
      .notNull()
      .references(() => interviewReports.id, { onDelete: 'cascade' }),
    moderatorId: uuid().references(() => users.id, { onDelete: 'set null' }),
    action: moderationActionEnum().notNull(),
    fromStatus: moderationStatusEnum().notNull(),
    toStatus: moderationStatusEnum().notNull(),
    reason: text().notNull(),
    sourceReviewed: boolean().notNull().default(false),
    originalityReviewed: boolean().notNull().default(false),
    ndaSafe: boolean().notNull().default(false),
    assignedEvidenceType: evidenceTypeEnum(),
    editedFields: jsonb().$type<string[]>().notNull().default([]),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('moderation_decisions_report_created_idx').on(table.reportId, table.createdAt),
    check('moderation_decisions_reason_not_empty', sql`length(${table.reason}) > 0`),
  ],
);

export const assessmentPapers = pgTable(
  'assessment_papers',
  {
    id: uuid().primaryKey().defaultRandom(),
    companyId: uuid()
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    slug: text().notNull(),
    title: text().notNull(),
    role: text().notNull(),
    patternPeriod: text().notNull(),
    paperType: assessmentPaperTypeEnum().notNull().default('pattern_based_mock'),
    durationMinutes: integer().notNull(),
    instructions: text().notNull(),
    status: problemStatusEnum().notNull().default('draft'),
    version: integer().notNull().default(1),
    contentLicenseId: uuid()
      .notNull()
      .references(() => contentLicenses.id, { onDelete: 'restrict' }),
    createdBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('assessment_papers_slug_key').on(table.slug),
    index('assessment_papers_company_status_idx').on(table.companyId, table.status),
    check('assessment_papers_duration_positive', sql`${table.durationMinutes} > 0`),
    check('assessment_papers_version_positive', sql`${table.version} > 0`),
  ],
);

export const assessmentPaperQuestions = pgTable(
  'assessment_paper_questions',
  {
    id: uuid().primaryKey().defaultRandom(),
    paperId: uuid()
      .notNull()
      .references(() => assessmentPapers.id, { onDelete: 'cascade' }),
    problemId: uuid()
      .notNull()
      .references(() => problems.id, { onDelete: 'restrict' }),
    ordinal: smallint().notNull(),
    marks: smallint().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('assessment_paper_questions_paper_ordinal_key').on(
      table.paperId,
      table.ordinal,
    ),
    uniqueIndex('assessment_paper_questions_paper_problem_key').on(
      table.paperId,
      table.problemId,
    ),
    check('assessment_paper_questions_ordinal_positive', sql`${table.ordinal} > 0`),
    check('assessment_paper_questions_marks_positive', sql`${table.marks} > 0`),
  ],
);

export const assessmentAttempts = pgTable(
  'assessment_attempts',
  {
    id: uuid().primaryKey().defaultRandom(),
    paperId: uuid()
      .notNull()
      .references(() => assessmentPapers.id, { onDelete: 'restrict' }),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    status: assessmentAttemptStatusEnum().notNull().default('in_progress'),
    startedAt: timestamp({ withTimezone: true }).notNull(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    activeQuestionId: uuid().references(() => assessmentPaperQuestions.id, {
      onDelete: 'set null',
    }),
    lastInteractionAt: timestamp({ withTimezone: true }).notNull(),
    submittedAt: timestamp({ withTimezone: true }),
    score: integer().notNull().default(0),
    maximumScore: integer().notNull(),
    verdictBreakdown: jsonb().$type<Record<string, number>>().notNull().default({}),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('assessment_attempts_user_history_idx').on(table.userId, table.createdAt),
    index('assessment_attempts_expiry_idx').on(table.status, table.expiresAt),
    check(
      'assessment_attempts_expiry_after_start',
      sql`${table.expiresAt} > ${table.startedAt}`,
    ),
    check(
      'assessment_attempts_score_coherent',
      sql`${table.score} >= 0 and ${table.maximumScore} >= ${table.score}`,
    ),
    check(
      'assessment_attempts_terminal_has_submission',
      sql`${table.status} = 'in_progress' or ${table.submittedAt} is not null`,
    ),
  ],
);

export const assessmentAnswers = pgTable(
  'assessment_answers',
  {
    id: uuid().primaryKey().defaultRandom(),
    attemptId: uuid()
      .notNull()
      .references(() => assessmentAttempts.id, { onDelete: 'cascade' }),
    paperQuestionId: uuid()
      .notNull()
      .references(() => assessmentPaperQuestions.id, { onDelete: 'restrict' }),
    language: executionLanguageEnum().notNull(),
    source: text().notNull(),
    executionJobId: uuid().references(() => executionJobs.id, { onDelete: 'set null' }),
    verdict: executionVerdictEnum(),
    marksAwarded: smallint().notNull().default(0),
    timeSpentSeconds: integer().notNull().default(0),
    submittedAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('assessment_answers_attempt_question_key').on(
      table.attemptId,
      table.paperQuestionId,
    ),
    index('assessment_answers_execution_job_idx').on(table.executionJobId),
    check('assessment_answers_source_not_empty', sql`length(${table.source}) > 0`),
    check('assessment_answers_marks_non_negative', sql`${table.marksAwarded} >= 0`),
    check('assessment_answers_time_non_negative', sql`${table.timeSpentSeconds} >= 0`),
  ],
);

export type ProblemVersion = typeof problemVersions.$inferSelect;
export type ProblemLanguageTemplate = typeof problemLanguageTemplates.$inferSelect;
export type NativeTestCase = typeof testCases.$inferSelect;
export type Company = typeof companies.$inferSelect;
export type InterviewReport = typeof interviewReports.$inferSelect;
export type AssessmentPaper = typeof assessmentPapers.$inferSelect;
export type AssessmentAttempt = typeof assessmentAttempts.$inferSelect;
