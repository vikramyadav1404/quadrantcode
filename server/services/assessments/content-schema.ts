import { z } from 'zod';

export const INITIAL_ASSESSMENT_COMPANY_SLUGS = [
  'amazon',
  'google',
  'microsoft',
  'meta',
  'adobe',
  'flipkart',
  'atlassian',
  'uber',
  'goldman-sachs',
  'walmart',
] as const;

const slugSchema = z
  .string()
  .min(3)
  .max(120)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

export const assessmentPaperContentSchema = z
  .object({
    slug: slugSchema,
    title: z.string().min(10).max(160),
    /**
     * Absent for a general mock OA. Such a paper names no company anywhere —
     * see the C3 check in `assessmentPaperLibrarySchema`.
     */
    companySlug: z.enum(INITIAL_ASSESSMENT_COMPANY_SLUGS).optional(),
    role: z.string().min(3).max(120),
    patternPeriod: z.string().min(8).max(120),
    paperType: z.literal('pattern_based_mock'),
    durationMinutes: z.number().int().min(30).max(240),
    instructions: z.string().min(80).max(4_000),
    status: z.literal('needs_review'),
    version: z.number().int().positive(),
    provenance: z.object({
      contentSource: z.literal('quadrantcode-original'),
      independentlyCreated: z.literal(true),
      licenseName: z.string().min(3).max(120),
      author: z.string().min(3).max(120),
      note: z.string().min(20).max(2_000),
    }),
    questions: z
      .array(
        z.object({
          problemSlug: slugSchema,
          ordinal: z.number().int().positive(),
          marks: z.number().int().positive().max(100),
        }),
      )
      .min(3)
      .max(8),
  })
  .superRefine((paper, context) => {
    const ordinals = paper.questions.map((question) => question.ordinal);
    const expected = paper.questions.map((_, index) => index + 1);
    if (ordinals.join(',') !== expected.join(',')) {
      context.addIssue({
        code: 'custom',
        path: ['questions'],
        message: 'Question ordinals must be contiguous and start at one.',
      });
    }

    if (
      new Set(paper.questions.map((question) => question.problemSlug)).size !==
      paper.questions.length
    ) {
      context.addIssue({
        code: 'custom',
        path: ['questions'],
        message: 'A paper cannot contain the same problem twice.',
      });
    }

    if (paper.questions.reduce((total, question) => total + question.marks, 0) !== 100) {
      context.addIssue({
        code: 'custom',
        path: ['questions'],
        message: 'Every initial paper must total exactly 100 marks.',
      });
    }
  });

/** At most this many general papers, so each one can keep its own questions. */
export const MAX_GENERAL_PAPERS = 20;

/** The company names a general paper must not mention (C3: no company claims). */
const COMPANY_NAME_PATTERN = new RegExp(
  `\\b(${INITIAL_ASSESSMENT_COMPANY_SLUGS.map((slug) => slug.split('-')[0]).join('|')})\\b`,
  'i',
);

/**
 * Two kinds of paper share one library.
 *
 * - **Company papers** keep F4.5's original rule untouched: if any exist, every
 *   initial company has exactly two, twenty in all.
 * - **General mock OAs** (no `companySlug`) name no company in their slug,
 *   title, role, pattern period or instructions, and no problem appears in two
 *   of them — a general paper reusing another's question would be the same
 *   reskinning the 2026-09-22 retirement removed.
 */
export const assessmentPaperLibrarySchema = z
  .object({
    schemaVersion: z.literal(1),
    reviewStatus: z.literal('needs_review'),
    papers: z
      .array(assessmentPaperContentSchema)
      .min(1)
      .max(20 + MAX_GENERAL_PAPERS),
  })
  .superRefine((library, context) => {
    const slugs = new Set<string>();
    const titles = new Set<string>();
    const counts = new Map<string, number>();
    const generalProblems = new Set<string>();
    let companyPapers = 0;
    let generalPapers = 0;

    for (const [index, paper] of library.papers.entries()) {
      if (slugs.has(paper.slug)) {
        context.addIssue({
          code: 'custom',
          path: ['papers', index, 'slug'],
          message: 'Duplicate paper slug.',
        });
      }
      if (titles.has(paper.title.toLocaleLowerCase())) {
        context.addIssue({
          code: 'custom',
          path: ['papers', index, 'title'],
          message: 'Duplicate paper title.',
        });
      }
      slugs.add(paper.slug);
      titles.add(paper.title.toLocaleLowerCase());

      if (paper.companySlug) {
        companyPapers += 1;
        counts.set(paper.companySlug, (counts.get(paper.companySlug) ?? 0) + 1);
        continue;
      }

      generalPapers += 1;
      const text = [
        paper.slug.replaceAll('-', ' '),
        paper.title,
        paper.role,
        paper.patternPeriod,
        paper.instructions,
      ].join(' ');
      if (COMPANY_NAME_PATTERN.test(text)) {
        context.addIssue({
          code: 'custom',
          path: ['papers', index],
          message: 'A general paper must not name a company.',
        });
      }
      for (const question of paper.questions) {
        if (generalProblems.has(question.problemSlug)) {
          context.addIssue({
            code: 'custom',
            path: ['papers', index, 'questions'],
            message: `${question.problemSlug} already appears in another general paper.`,
          });
        }
        generalProblems.add(question.problemSlug);
      }
    }

    if (generalPapers > MAX_GENERAL_PAPERS) {
      context.addIssue({
        code: 'custom',
        path: ['papers'],
        message: `At most ${MAX_GENERAL_PAPERS} general papers.`,
      });
    }

    if (companyPapers > 0) {
      for (const companySlug of INITIAL_ASSESSMENT_COMPANY_SLUGS) {
        if (counts.get(companySlug) !== 2) {
          context.addIssue({
            code: 'custom',
            path: ['papers'],
            message: `Expected exactly two papers for ${companySlug}.`,
          });
        }
      }
    }
  });

export type AssessmentPaperContent = z.infer<typeof assessmentPaperContentSchema>;
export type AssessmentPaperLibrary = z.infer<typeof assessmentPaperLibrarySchema>;
