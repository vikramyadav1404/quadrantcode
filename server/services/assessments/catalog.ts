import { and, asc, count, eq, isNull } from 'drizzle-orm';
import type { Database } from '@/server/db';
import { assessmentPaperQuestions, assessmentPapers, problems } from '@/server/db/schema';

/**
 * General mock OAs: published papers with no company. Company papers stay under
 * /companies/[slug]/papers; these are listed at /mocks.
 */
export async function listGeneralPapers(db: Database) {
  return db
    .select({
      slug: assessmentPapers.slug,
      title: assessmentPapers.title,
      role: assessmentPapers.role,
      patternPeriod: assessmentPapers.patternPeriod,
      durationMinutes: assessmentPapers.durationMinutes,
      questionCount: count(assessmentPaperQuestions.id),
    })
    .from(assessmentPapers)
    .leftJoin(
      assessmentPaperQuestions,
      eq(assessmentPaperQuestions.paperId, assessmentPapers.id),
    )
    .where(and(isNull(assessmentPapers.companyId), eq(assessmentPapers.status, 'published')))
    .groupBy(assessmentPapers.id)
    .orderBy(asc(assessmentPapers.slug));
}

export async function getGeneralPaper(db: Database, paperSlug: string) {
  const [paper] = await db
    .select({
      id: assessmentPapers.id,
      slug: assessmentPapers.slug,
      title: assessmentPapers.title,
      role: assessmentPapers.role,
      patternPeriod: assessmentPapers.patternPeriod,
      durationMinutes: assessmentPapers.durationMinutes,
      instructions: assessmentPapers.instructions,
    })
    .from(assessmentPapers)
    .where(
      and(
        eq(assessmentPapers.slug, paperSlug),
        isNull(assessmentPapers.companyId),
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
      title: problems.title,
      difficulty: problems.difficulty,
    })
    .from(assessmentPaperQuestions)
    .innerJoin(problems, eq(problems.id, assessmentPaperQuestions.problemId))
    .where(eq(assessmentPaperQuestions.paperId, paper.id))
    .orderBy(asc(assessmentPaperQuestions.ordinal));
  return { paper, questions };
}
