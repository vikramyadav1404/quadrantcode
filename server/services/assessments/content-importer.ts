import { and, asc, eq, sql } from 'drizzle-orm';
import type { Database } from '@/server/db/client';
import {
  assessmentPaperQuestions,
  assessmentPapers,
  companies,
  contentLicenses,
  problems,
} from '@/server/db/schema';
import type { AssessmentPaperLibrary } from './content-schema';

export type AssessmentPaperImportResult = {
  papers: number;
  papersCreated: number;
  papersUnchanged: number;
};

export async function importAssessmentPaperLibrary(
  db: Database,
  library: AssessmentPaperLibrary,
): Promise<AssessmentPaperImportResult> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('quadrantcode-paper-import'))`);
    let papersCreated = 0;
    let papersUnchanged = 0;

    for (const paper of library.papers) {
      const [company] = await tx
        .select({ id: companies.id })
        .from(companies)
        .where(eq(companies.slug, paper.companySlug))
        .limit(1);
      if (!company)
        throw new Error(`Unknown company ${paper.companySlug}. Import companies first.`);

      const [license] = await tx
        .insert(contentLicenses)
        .values({
          provenance: paper.provenance.contentSource,
          licenseName: paper.provenance.licenseName,
          author: paper.provenance.author,
          independentlyCreated: paper.provenance.independentlyCreated,
          reviewNotes: paper.provenance.note,
        })
        .onConflictDoUpdate({
          target: [
            contentLicenses.provenance,
            contentLicenses.licenseName,
            contentLicenses.author,
          ],
          set: { independentlyCreated: true, reviewNotes: paper.provenance.note },
        })
        .returning({ id: contentLicenses.id });
      if (!license) throw new Error(`Could not upsert content license for ${paper.slug}.`);

      const [existing] = await tx
        .select({
          id: assessmentPapers.id,
          version: assessmentPapers.version,
          title: assessmentPapers.title,
          role: assessmentPapers.role,
          patternPeriod: assessmentPapers.patternPeriod,
          durationMinutes: assessmentPapers.durationMinutes,
          instructions: assessmentPapers.instructions,
          companyId: assessmentPapers.companyId,
        })
        .from(assessmentPapers)
        .where(eq(assessmentPapers.slug, paper.slug))
        .limit(1);

      let paperId = existing?.id;
      if (existing) {
        const unchanged =
          existing.version === paper.version &&
          existing.title === paper.title &&
          existing.role === paper.role &&
          existing.patternPeriod === paper.patternPeriod &&
          existing.durationMinutes === paper.durationMinutes &&
          existing.instructions === paper.instructions &&
          existing.companyId === company.id;
        if (!unchanged) {
          throw new Error(
            `${paper.slug} changed after import. Create a new slug/version instead of mutating an assessment.`,
          );
        }
      } else {
        const [created] = await tx
          .insert(assessmentPapers)
          .values({
            companyId: company.id,
            slug: paper.slug,
            title: paper.title,
            role: paper.role,
            patternPeriod: paper.patternPeriod,
            paperType: paper.paperType,
            durationMinutes: paper.durationMinutes,
            instructions: paper.instructions,
            status: paper.status,
            version: paper.version,
            contentLicenseId: license.id,
          })
          .returning({ id: assessmentPapers.id });
        if (!created) throw new Error(`Could not create assessment paper ${paper.slug}.`);
        paperId = created.id;
        papersCreated += 1;
      }

      const expectedQuestions: { problemId: string; ordinal: number; marks: number }[] = [];
      for (const question of paper.questions) {
        const [problem] = await tx
          .select({ id: problems.id })
          .from(problems)
          .where(
            and(eq(problems.slug, question.problemSlug), eq(problems.sourceType, 'original')),
          )
          .limit(1);
        if (!problem) throw new Error(`Unknown original problem ${question.problemSlug}.`);
        expectedQuestions.push({
          problemId: problem.id,
          ordinal: question.ordinal,
          marks: question.marks,
        });
      }

      if (existing) {
        const actualQuestions = await tx
          .select({
            problemId: assessmentPaperQuestions.problemId,
            ordinal: assessmentPaperQuestions.ordinal,
            marks: assessmentPaperQuestions.marks,
          })
          .from(assessmentPaperQuestions)
          .where(eq(assessmentPaperQuestions.paperId, paperId!))
          .orderBy(asc(assessmentPaperQuestions.ordinal));
        if (JSON.stringify(actualQuestions) !== JSON.stringify(expectedQuestions)) {
          throw new Error(`${paper.slug} question set changed after import.`);
        }
        papersUnchanged += 1;
      } else {
        await tx
          .insert(assessmentPaperQuestions)
          .values(expectedQuestions.map((question) => ({ paperId: paperId!, ...question })));
      }
    }

    return { papers: library.papers.length, papersCreated, papersUnchanged };
  });
}
