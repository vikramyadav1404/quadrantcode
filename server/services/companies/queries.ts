import {
  type SQL,
  and,
  asc,
  count,
  countDistinct,
  desc,
  eq,
  exists,
  gte,
  lte,
  or,
  sql,
} from 'drizzle-orm';
import { z } from 'zod';
import type { Database } from '@/server/db';
import {
  assessmentPaperQuestions,
  assessmentPapers,
  companies,
  interviewReportQuestions,
  interviewReports,
  problemCompanyEvidence,
  problemTopics,
  problems,
  topics,
} from '@/server/db/schema';
import { EVIDENCE_TYPES } from '@/lib/native/constants';

export const companyProblemFiltersSchema = z.object({
  role: z.string().trim().max(120).optional(),
  round: z.string().trim().max(120).optional(),
  year: z.coerce.number().int().min(1990).max(2100).optional(),
  difficulty: z.enum(['easy', 'medium', 'hard']).optional(),
  topic: z
    .string()
    .regex(/^[a-z0-9-]+$/)
    .optional(),
  evidence: z.enum(EVIDENCE_TYPES).optional(),
});

export type CompanyProblemFilters = z.infer<typeof companyProblemFiltersSchema>;

export async function listCompanies(db: Database) {
  return db
    .select({
      id: companies.id,
      slug: companies.slug,
      name: companies.name,
      overview: companies.overview,
      problemCount: countDistinct(problemCompanyEvidence.problemId),
      paperCount: countDistinct(assessmentPapers.id),
    })
    .from(companies)
    .leftJoin(problemCompanyEvidence, eq(problemCompanyEvidence.companyId, companies.id))
    .leftJoin(assessmentPapers, eq(assessmentPapers.companyId, companies.id))
    .where(eq(companies.isActive, true))
    .groupBy(companies.id)
    .orderBy(asc(companies.name));
}

export async function getCompanyPageData(db: Database, slug: string, rawFilters: unknown) {
  const filters = companyProblemFiltersSchema.parse(rawFilters ?? {});
  const [company] = await db
    .select()
    .from(companies)
    .where(and(eq(companies.slug, slug), eq(companies.isActive, true)))
    .limit(1);
  if (!company) return null;

  const conditions: SQL[] = [
    eq(problemCompanyEvidence.companyId, company.id),
    eq(problems.status, 'published'),
  ];
  if (filters.role) conditions.push(eq(problemCompanyEvidence.role, filters.role));
  if (filters.round) conditions.push(eq(problemCompanyEvidence.round, filters.round));
  if (filters.difficulty) conditions.push(eq(problems.difficulty, filters.difficulty));
  if (filters.evidence)
    conditions.push(eq(problemCompanyEvidence.evidenceType, filters.evidence));
  if (filters.year) {
    conditions.push(lte(problemCompanyEvidence.yearFrom, filters.year));
    conditions.push(
      or(
        sql`${problemCompanyEvidence.yearTo} is null`,
        gte(problemCompanyEvidence.yearTo, filters.year),
      )!,
    );
  }
  if (filters.topic) {
    conditions.push(
      exists(
        db
          .select({ one: sql`1` })
          .from(problemTopics)
          .innerJoin(topics, eq(topics.id, problemTopics.topicId))
          .where(and(eq(problemTopics.problemId, problems.id), eq(topics.slug, filters.topic))),
      ),
    );
  }

  const [problemRows, reportRows, paperRows, topicRows, filterRows] = await Promise.all([
    db
      .select({
        id: problems.id,
        slug: problems.slug,
        title: problems.title,
        difficulty: problems.difficulty,
        role: problemCompanyEvidence.role,
        round: problemCompanyEvidence.round,
        yearFrom: problemCompanyEvidence.yearFrom,
        yearTo: problemCompanyEvidence.yearTo,
        evidenceType: problemCompanyEvidence.evidenceType,
        reportCount: problemCompanyEvidence.reportCount,
        confidenceScore: problemCompanyEvidence.confidenceScore,
      })
      .from(problemCompanyEvidence)
      .innerJoin(problems, eq(problems.id, problemCompanyEvidence.problemId))
      .where(and(...conditions))
      .orderBy(asc(problems.difficulty), asc(problems.title)),
    db
      .select({
        id: interviewReports.id,
        role: interviewReports.role,
        round: interviewReports.round,
        interviewYear: interviewReports.interviewYear,
        location: interviewReports.location,
        experience: interviewReports.experience,
        displayAnonymously: interviewReports.displayAnonymously,
        concept: interviewReportQuestions.concept,
        recollection: interviewReportQuestions.recollection,
        difficulty: interviewReportQuestions.difficulty,
      })
      .from(interviewReports)
      .leftJoin(
        interviewReportQuestions,
        eq(interviewReportQuestions.reportId, interviewReports.id),
      )
      .where(
        and(
          eq(interviewReports.companyId, company.id),
          eq(interviewReports.status, 'published'),
          sql`${interviewReports.deletedAt} is null`,
        ),
      )
      .orderBy(desc(interviewReports.interviewYear)),
    db
      .select({
        slug: assessmentPapers.slug,
        title: assessmentPapers.title,
        role: assessmentPapers.role,
        patternPeriod: assessmentPapers.patternPeriod,
        paperType: assessmentPapers.paperType,
        durationMinutes: assessmentPapers.durationMinutes,
        questionCount: count(assessmentPaperQuestions.id),
      })
      .from(assessmentPapers)
      .leftJoin(
        assessmentPaperQuestions,
        eq(assessmentPaperQuestions.paperId, assessmentPapers.id),
      )
      .where(
        and(
          eq(assessmentPapers.companyId, company.id),
          eq(assessmentPapers.status, 'published'),
        ),
      )
      .groupBy(assessmentPapers.id)
      .orderBy(asc(assessmentPapers.title)),
    db
      .select({ topic: topics.name, count: countDistinct(problemCompanyEvidence.id) })
      .from(problemCompanyEvidence)
      .innerJoin(problemTopics, eq(problemTopics.problemId, problemCompanyEvidence.problemId))
      .innerJoin(topics, eq(topics.id, problemTopics.topicId))
      .where(eq(problemCompanyEvidence.companyId, company.id))
      .groupBy(topics.id)
      .orderBy(desc(countDistinct(problemCompanyEvidence.id)), asc(topics.name)),
    db
      .selectDistinct({
        role: problemCompanyEvidence.role,
        round: problemCompanyEvidence.round,
        yearFrom: problemCompanyEvidence.yearFrom,
      })
      .from(problemCompanyEvidence)
      .where(eq(problemCompanyEvidence.companyId, company.id)),
  ]);

  const problemIds = problemRows.map((problem) => problem.id);
  const topicTags =
    problemIds.length === 0
      ? []
      : await db
          .select({ problemId: problemTopics.problemId, slug: topics.slug })
          .from(problemTopics)
          .innerJoin(topics, eq(topics.id, problemTopics.topicId))
          .where(sql`${problemTopics.problemId} in ${problemIds}`);

  return {
    company,
    filters,
    problems: problemRows.map((problem) => ({
      ...problem,
      topics: topicTags
        .filter((topic) => topic.problemId === problem.id)
        .map((topic) => topic.slug),
    })),
    reports: reportRows,
    papers: paperRows,
    topicInsights: topicRows,
    filterOptions: {
      roles: [...new Set(filterRows.map((row) => row.role).filter(Boolean))] as string[],
      rounds: [...new Set(filterRows.map((row) => row.round).filter(Boolean))] as string[],
      years: [...new Set(filterRows.map((row) => row.yearFrom).filter(Boolean))] as number[],
    },
  };
}

export async function listCompanyPapers(db: Database, companySlug: string) {
  const [company] = await db
    .select()
    .from(companies)
    .where(and(eq(companies.slug, companySlug), eq(companies.isActive, true)))
    .limit(1);
  if (!company) return null;
  const papers = await db
    .select({
      slug: assessmentPapers.slug,
      title: assessmentPapers.title,
      role: assessmentPapers.role,
      patternPeriod: assessmentPapers.patternPeriod,
      paperType: assessmentPapers.paperType,
      durationMinutes: assessmentPapers.durationMinutes,
      questionCount: count(assessmentPaperQuestions.id),
    })
    .from(assessmentPapers)
    .leftJoin(
      assessmentPaperQuestions,
      eq(assessmentPaperQuestions.paperId, assessmentPapers.id),
    )
    .where(
      and(eq(assessmentPapers.companyId, company.id), eq(assessmentPapers.status, 'published')),
    )
    .groupBy(assessmentPapers.id)
    .orderBy(asc(assessmentPapers.title));
  return { company, papers };
}

export async function getCompanyPaper(db: Database, companySlug: string, paperSlug: string) {
  const [paper] = await db
    .select({
      id: assessmentPapers.id,
      slug: assessmentPapers.slug,
      title: assessmentPapers.title,
      role: assessmentPapers.role,
      patternPeriod: assessmentPapers.patternPeriod,
      paperType: assessmentPapers.paperType,
      durationMinutes: assessmentPapers.durationMinutes,
      instructions: assessmentPapers.instructions,
      companyId: companies.id,
      companyName: companies.name,
      companySlug: companies.slug,
    })
    .from(assessmentPapers)
    .innerJoin(companies, eq(companies.id, assessmentPapers.companyId))
    .where(
      and(
        eq(companies.slug, companySlug),
        eq(assessmentPapers.slug, paperSlug),
        eq(assessmentPapers.status, 'published'),
      ),
    )
    .limit(1);
  if (!paper) return null;
  const questions = await db
    .select({
      id: assessmentPaperQuestions.id,
      ordinal: assessmentPaperQuestions.ordinal,
      marks: assessmentPaperQuestions.marks,
      slug: problems.slug,
      title: problems.title,
      difficulty: problems.difficulty,
    })
    .from(assessmentPaperQuestions)
    .innerJoin(problems, eq(problems.id, assessmentPaperQuestions.problemId))
    .where(eq(assessmentPaperQuestions.paperId, paper.id))
    .orderBy(asc(assessmentPaperQuestions.ordinal));
  return { paper, questions };
}
