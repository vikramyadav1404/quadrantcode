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
    companySlug: z.enum(INITIAL_ASSESSMENT_COMPANY_SLUGS),
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

export const assessmentPaperLibrarySchema = z
  .object({
    schemaVersion: z.literal(1),
    reviewStatus: z.literal('needs_review'),
    papers: z.array(assessmentPaperContentSchema).length(20),
  })
  .superRefine((library, context) => {
    const slugs = new Set<string>();
    const titles = new Set<string>();
    const counts = new Map<string, number>();

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
      counts.set(paper.companySlug, (counts.get(paper.companySlug) ?? 0) + 1);
    }

    for (const companySlug of INITIAL_ASSESSMENT_COMPANY_SLUGS) {
      if (counts.get(companySlug) !== 2) {
        context.addIssue({
          code: 'custom',
          path: ['papers'],
          message: `Expected exactly two papers for ${companySlug}.`,
        });
      }
    }
  });

export type AssessmentPaperContent = z.infer<typeof assessmentPaperContentSchema>;
export type AssessmentPaperLibrary = z.infer<typeof assessmentPaperLibrarySchema>;
