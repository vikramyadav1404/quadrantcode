import { and, asc, count, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import type { Database, Transaction } from '@/server/db';
import {
  assessmentAttempts,
  assessmentPaperQuestions,
  assessmentPapers,
  companies,
  contentLicenses,
  problems,
} from '@/server/db/schema';
import { recordAudit } from '@/server/lib/observability/audit';

const paperSchema = z
  .object({
    paperId: z.string().uuid().optional(),
    companySlug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    slug: z
      .string()
      .min(3)
      .max(120)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    title: z.string().min(10).max(160),
    role: z.string().min(3).max(120),
    patternPeriod: z.string().min(8).max(120),
    durationMinutes: z.coerce.number().int().min(30).max(240),
    instructions: z.string().min(80).max(4_000),
    questionSlugs: z.string().transform(list),
    marks: z.string().transform((value, context) => {
      const parsed = list(value).map(Number);
      if (parsed.some((mark) => !Number.isInteger(mark) || mark <= 0 || mark > 100)) {
        context.addIssue({ code: 'custom', message: 'Marks must be positive integers.' });
        return z.NEVER;
      }
      return parsed;
    }),
  })
  .superRefine((value, context) => {
    if (value.questionSlugs.length < 3 || value.questionSlugs.length > 8) {
      context.addIssue({
        code: 'custom',
        path: ['questionSlugs'],
        message: 'Use 3–8 ordered questions.',
      });
    }
    if (new Set(value.questionSlugs).size !== value.questionSlugs.length) {
      context.addIssue({
        code: 'custom',
        path: ['questionSlugs'],
        message: 'Question slugs must be unique.',
      });
    }
    if (value.marks.length !== value.questionSlugs.length) {
      context.addIssue({
        code: 'custom',
        path: ['marks'],
        message: 'Provide one marks value per question.',
      });
    }
    if (value.marks.reduce((total, mark) => total + mark, 0) !== 100) {
      context.addIssue({
        code: 'custom',
        path: ['marks'],
        message: 'Paper marks must total exactly 100.',
      });
    }
  });

type DbExecutor = Database | Transaction;

export async function listAdminPapers(db: Database) {
  const papers = await db
    .select({
      id: assessmentPapers.id,
      slug: assessmentPapers.slug,
      title: assessmentPapers.title,
      role: assessmentPapers.role,
      patternPeriod: assessmentPapers.patternPeriod,
      durationMinutes: assessmentPapers.durationMinutes,
      instructions: assessmentPapers.instructions,
      paperType: assessmentPapers.paperType,
      status: assessmentPapers.status,
      version: assessmentPapers.version,
      companyName: companies.name,
      companySlug: companies.slug,
      attemptCount: count(assessmentAttempts.id),
    })
    .from(assessmentPapers)
    .innerJoin(companies, eq(companies.id, assessmentPapers.companyId))
    .leftJoin(assessmentAttempts, eq(assessmentAttempts.paperId, assessmentPapers.id))
    .groupBy(assessmentPapers.id, companies.id)
    .orderBy(asc(companies.name), asc(assessmentPapers.title));
  const questions = papers.length
    ? await db
        .select({
          paperId: assessmentPaperQuestions.paperId,
          ordinal: assessmentPaperQuestions.ordinal,
          marks: assessmentPaperQuestions.marks,
          problemSlug: problems.slug,
          problemTitle: problems.title,
        })
        .from(assessmentPaperQuestions)
        .innerJoin(problems, eq(problems.id, assessmentPaperQuestions.problemId))
        .where(
          inArray(
            assessmentPaperQuestions.paperId,
            papers.map((paper) => paper.id),
          ),
        )
        .orderBy(asc(assessmentPaperQuestions.ordinal))
    : [];
  return papers.map((paper) => ({
    ...paper,
    questions: questions.filter((question) => question.paperId === paper.id),
  }));
}

export async function createAdminPaper(db: Database, actorId: string, rawInput: unknown) {
  const input = paperSchema.parse(rawInput);
  await db.transaction(async (tx) => {
    const company = await findCompany(tx, input.companySlug);
    const license = await originalPaperLicense(tx);
    const [paper] = await tx
      .insert(assessmentPapers)
      .values({
        companyId: company.id,
        slug: input.slug,
        title: input.title,
        role: input.role,
        patternPeriod: input.patternPeriod,
        paperType: 'pattern_based_mock',
        durationMinutes: input.durationMinutes,
        instructions: input.instructions,
        status: 'draft',
        contentLicenseId: license.id,
        createdBy: actorId,
      })
      .returning({ id: assessmentPapers.id });
    if (!paper) throw new Error('Paper insert returned no row.');
    await replaceQuestions(tx, paper.id, input.questionSlugs, input.marks);
    await recordAudit(tx, {
      actorId,
      action: 'assessment_paper.created',
      target: `paper:${paper.id}`,
      after: {
        slug: input.slug,
        paperType: 'pattern_based_mock',
        questions: input.questionSlugs.length,
      },
    });
  });
}

export async function updateAdminPaper(db: Database, actorId: string, rawInput: unknown) {
  const input = paperSchema.extend({ paperId: z.string().uuid() }).parse(rawInput);
  await db.transaction(async (tx) => {
    const [paper] = await tx
      .select()
      .from(assessmentPapers)
      .where(eq(assessmentPapers.id, input.paperId))
      .limit(1);
    if (!paper) throw new Error('Paper was not found.');
    if (paper.status === 'published' || paper.status === 'archived')
      throw new Error('Published or archived papers are immutable.');
    const [attempts] = await tx
      .select({ value: count() })
      .from(assessmentAttempts)
      .where(eq(assessmentAttempts.paperId, paper.id));
    if ((attempts?.value ?? 0) > 0)
      throw new Error('A paper with attempts cannot have its questions replaced.');
    const company = await findCompany(tx, input.companySlug);
    await tx
      .update(assessmentPapers)
      .set({
        companyId: company.id,
        slug: input.slug,
        title: input.title,
        role: input.role,
        patternPeriod: input.patternPeriod,
        durationMinutes: input.durationMinutes,
        instructions: input.instructions,
        status: 'needs_review',
        updatedAt: new Date(),
      })
      .where(eq(assessmentPapers.id, paper.id));
    await tx
      .delete(assessmentPaperQuestions)
      .where(eq(assessmentPaperQuestions.paperId, paper.id));
    await replaceQuestions(tx, paper.id, input.questionSlugs, input.marks);
    await recordAudit(tx, {
      actorId,
      action: 'assessment_paper.updated',
      target: `paper:${paper.id}`,
      before: { status: paper.status },
      after: { status: 'needs_review', questions: input.questionSlugs.length },
    });
  });
}

export async function reviewAdminPaper(db: Database, actorId: string, paperId: string) {
  await db.transaction(async (tx) => {
    const id = z.string().uuid().parse(paperId);
    const [paper] = await tx
      .select()
      .from(assessmentPapers)
      .where(eq(assessmentPapers.id, id))
      .limit(1);
    if (!paper || !['draft', 'needs_review'].includes(paper.status))
      throw new Error('Only draft or needs-review papers can enter review.');
    await assertPaperShape(tx, id, false);
    await tx
      .update(assessmentPapers)
      .set({ status: 'review', updatedAt: new Date() })
      .where(eq(assessmentPapers.id, id));
    await recordAudit(tx, {
      actorId,
      action: 'assessment_paper.review_requested',
      target: `paper:${id}`,
      before: { status: paper.status },
      after: { status: 'review' },
    });
  });
}

export async function publishAdminPaper(
  db: Database,
  actorId: string,
  paperId: string,
  patternLabelConfirmed: boolean,
) {
  if (!patternLabelConfirmed)
    throw new Error('Confirm that this is only a pattern-based mock.');
  await db.transaction(async (tx) => {
    const id = z.string().uuid().parse(paperId);
    const [paper] = await tx
      .select()
      .from(assessmentPapers)
      .where(eq(assessmentPapers.id, id))
      .limit(1);
    if (!paper || paper.status !== 'review' || paper.paperType !== 'pattern_based_mock')
      throw new Error('Only reviewed pattern-based mocks can publish through this workflow.');
    await assertPaperShape(tx, id, true);
    await tx
      .update(assessmentPapers)
      .set({ status: 'published', updatedAt: new Date() })
      .where(eq(assessmentPapers.id, id));
    await recordAudit(tx, {
      actorId,
      action: 'assessment_paper.published',
      target: `paper:${id}`,
      before: { status: paper.status },
      after: { status: 'published', paperType: paper.paperType },
    });
  });
}

async function replaceQuestions(
  db: DbExecutor,
  paperId: string,
  slugs: string[],
  marks: number[],
) {
  const rows = await db
    .select({ id: problems.id, slug: problems.slug, sourceType: problems.sourceType })
    .from(problems)
    .where(inArray(problems.slug, slugs));
  if (rows.length !== slugs.length) throw new Error('One or more problem slugs do not exist.');
  if (rows.some((problem) => problem.sourceType !== 'original'))
    throw new Error('Assessments can contain only Quadrantcode-original problems.');
  await db.insert(assessmentPaperQuestions).values(
    slugs.map((slug, index) => ({
      paperId,
      problemId: rows.find((problem) => problem.slug === slug)!.id,
      ordinal: index + 1,
      marks: marks[index]!,
    })),
  );
}

async function assertPaperShape(
  db: DbExecutor,
  paperId: string,
  requirePublishedProblems: boolean,
) {
  const questions = await db
    .select({
      marks: assessmentPaperQuestions.marks,
      problemStatus: problems.status,
      sourceType: problems.sourceType,
    })
    .from(assessmentPaperQuestions)
    .innerJoin(problems, eq(problems.id, assessmentPaperQuestions.problemId))
    .where(eq(assessmentPaperQuestions.paperId, paperId));
  if (
    questions.length < 3 ||
    questions.length > 8 ||
    questions.reduce((sum, question) => sum + question.marks, 0) !== 100
  )
    throw new Error('Paper requires 3–8 ordered questions totaling 100 marks.');
  if (questions.some((question) => question.sourceType !== 'original'))
    throw new Error('Paper contains an external problem.');
  if (
    requirePublishedProblems &&
    questions.some((question) => question.problemStatus !== 'published')
  )
    throw new Error('Every question must pass native publication validation first.');
}

async function findCompany(db: DbExecutor, slug: string) {
  const [company] = await db
    .select({ id: companies.id })
    .from(companies)
    .where(and(eq(companies.slug, slug), eq(companies.isActive, true)))
    .limit(1);
  if (!company) throw new Error('Active company was not found.');
  return company;
}

async function originalPaperLicense(db: DbExecutor) {
  const [license] = await db
    .insert(contentLicenses)
    .values({
      provenance: 'quadrantcode-original',
      licenseName: 'Quadrantcode Original Practice Content License',
      author: 'Quadrantcode editorial team',
      independentlyCreated: true,
      reviewNotes: 'Independent pattern-based assessment content.',
    })
    .onConflictDoUpdate({
      target: [contentLicenses.provenance, contentLicenses.licenseName, contentLicenses.author],
      set: { independentlyCreated: true },
    })
    .returning({ id: contentLicenses.id });
  if (!license) throw new Error('Paper content license could not be created.');
  return license;
}

function list(value: string): string[] {
  return value
    .split(/[\r\n,]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}
