import { z } from 'zod';
import { EVIDENCE_TYPES, PROBLEM_TYPES, TEST_CASE_VISIBILITIES } from '@/lib/native/constants';
import { EXECUTION_LANGUAGES, type ExecutionLanguage } from '@/lib/execution/languages';
import { WRAPPER_SHAPES, WRAPPER_SHAPE_IDS, type WrapperShapeId } from './wrapper-shapes';

export const NATIVE_TOPIC_DISTRIBUTION = {
  'arrays-hashing': 15,
  'two-pointers-sliding-window': 10,
  'binary-search': 8,
  'stack-queue': 8,
  'linked-list': 7,
  'trees-bst': 12,
  'heap-greedy': 8,
  graphs: 12,
  'backtracking-trie-bit': 8,
  'dynamic-programming': 12,
} as const;

export const NATIVE_DIFFICULTY_DISTRIBUTION = {
  easy: 35,
  medium: 45,
  hard: 20,
} as const;

export const NATIVE_TOPIC_SLUGS = Object.keys(
  NATIVE_TOPIC_DISTRIBUTION,
) as (keyof typeof NATIVE_TOPIC_DISTRIBUTION)[];

const slugSchema = z
  .string()
  .min(3)
  .max(100)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Use lowercase kebab-case.');

const functionContractSchema = z.object({
  className: z.string().min(1).max(80).optional(),
  functionName: z.string().min(1).max(80),
  parameters: z
    .array(
      z.object({
        name: z.string().min(1).max(80),
        type: z.string().min(1).max(120),
        description: z.string().min(8).max(500),
      }),
    )
    .min(1)
    .max(8),
  returnType: z.string().min(1).max(120),
});

const exampleSchema = z.object({
  input: z.string().max(8_192),
  output: z.string().min(1).max(8_192),
  explanation: z.string().min(20).max(3_000),
});

const testCaseSchema = z.object({
  visibility: z.enum(TEST_CASE_VISIBILITIES),
  input: z.string().max(65_536),
  expectedOutput: z.string().min(1).max(65_536),
  explanation: z.string().max(2_000).optional(),
  coverage: z.enum([
    'sample',
    'empty',
    'minimum',
    'maximum',
    'duplicates',
    'adversarial',
    'performance',
    'typical',
  ]),
  isPerformance: z.boolean().default(false),
});

/**
 * What a record supplies per language, and what it receives back.
 *
 * A record carries only its `referenceSolution`. The other seven fields are the
 * execution contract, held once per shape in `wrapper-shapes.ts` and expanded
 * while parsing — see the transform at the bottom of `nativeProblemSchema`.
 *
 * `NativeLanguageTemplate` is written out rather than inferred because it is
 * the *output* type and must stay exactly what consumers already receive. The
 * registry is `as const`, so inferring from it would narrow every field to a
 * literal type and quietly change the contract.
 */
export type NativeLanguageTemplate = {
  displayName: string;
  runtimeVersion: string | null;
  judge0LanguageId: number | null;
  functionSignature: string;
  starterCode: string;
  wrapperTemplate: string;
  serialization: { input: string; output: string; equality: 'exact_json' };
  referenceSolution: string;
};

const languageReferenceSchema = z.object({
  referenceSolution: z.string().min(10).max(65_536),
});

const languageReferencesSchema = z.object({
  c11: languageReferenceSchema,
  cpp17: languageReferenceSchema,
  java: languageReferenceSchema,
  python3: languageReferenceSchema,
  javascript: languageReferenceSchema,
});

/** Expand a shape into the full per-language block a record used to spell out. */
function expandShape(
  shape: WrapperShapeId,
  references: z.infer<typeof languageReferencesSchema>,
): Record<ExecutionLanguage, NativeLanguageTemplate> {
  const templates = WRAPPER_SHAPES[shape];
  return Object.fromEntries(
    EXECUTION_LANGUAGES.map((language) => [
      language,
      { ...templates[language], referenceSolution: references[language].referenceSolution },
    ]),
  ) as Record<ExecutionLanguage, NativeLanguageTemplate>;
}

const companyAssociationSchema = z.object({
  companySlug: slugSchema,
  evidenceType: z.enum(EVIDENCE_TYPES).default('company_pattern'),
  role: z.string().max(120).nullable().default(null),
  round: z.string().max(120).nullable().default(null),
  candidateLevel: z.enum(['internship', 'fresher', 'experienced']).nullable().default(null),
  yearFrom: z.number().int().min(1990).max(2100).nullable().default(null),
  yearTo: z.number().int().min(1990).max(2100).nullable().default(null),
  location: z.string().max(160).nullable().default(null),
  sourceUrl: z.string().url().nullable().default(null),
  reportCount: z.number().int().nonnegative().default(0),
  confidenceScore: z.number().int().min(0).max(100).default(0),
  verificationStatus: z
    .enum(['unverified', 'reviewed', 'verified', 'rejected'])
    .default('unverified'),
  lastReviewedDate: z.iso.date().nullable().default(null),
});

export const nativeProblemSchema = z
  .object({
    slug: slugSchema,
    title: z.string().min(5).max(120),
    difficulty: z.enum(['easy', 'medium', 'hard']),
    primaryTopic: z.enum(NATIVE_TOPIC_SLUGS as [string, ...string[]]),
    topics: z.array(slugSchema).min(1).max(8),
    problemType: z.enum(PROBLEM_TYPES),
    version: z.number().int().positive(),
    status: z.enum(['draft', 'needs_review', 'review', 'tested', 'published']),
    estimatedMinutes: z.number().int().min(5).max(240),
    difficultyCalibration: z.number().int().min(-2).max(2).default(0),
    story: z.string().min(40).max(4_000),
    statement: z.string().min(80).max(20_000),
    inputFormat: z.string().min(20).max(4_000),
    outputFormat: z.string().min(20).max(4_000),
    functionContract: functionContractSchema,
    constraints: z.array(z.string().min(3).max(500)).min(3).max(20),
    examples: z.array(exampleSchema).min(2).max(6),
    testCases: z.array(testCaseSchema).min(6).max(80),
    timeLimitMs: z.number().int().min(250).max(20_000),
    memoryLimitKb: z.number().int().min(16_384).max(1_048_576),
    hints: z.array(z.string().min(15).max(1_000)).min(2).max(8),
    editorial: z.object({
      overview: z.string().min(80).max(10_000),
      bruteForceApproach: z.string().min(40).max(10_000).nullable(),
      optimalApproach: z.string().min(80).max(12_000),
      correctnessProof: z.string().min(80).max(12_000),
      timeComplexity: z.string().min(3).max(300),
      spaceComplexity: z.string().min(3).max(300),
    }),
    /**
     * The execution contract this problem speaks. One per record, not per
     * language: all five share the same input/output shape, and a per-language
     * shape would be meaningless. See `wrapper-shapes.ts`.
     */
    shape: z.enum(WRAPPER_SHAPE_IDS),
    languages: languageReferencesSchema,
    provenance: z.object({
      contentSource: z.literal('quadrantcode-original'),
      independentlyCreated: z.literal(true),
      licenseName: z.string().min(3).max(120),
      licenseUrl: z.string().url().nullable(),
      author: z.string().min(3).max(120),
      note: z.string().min(20).max(2_000),
    }),
    companies: z.array(companyAssociationSchema).max(10).default([]),
  })
  .superRefine((problem, context) => {
    if (!problem.topics.includes(problem.primaryTopic)) {
      context.addIssue({
        code: 'custom',
        path: ['topics'],
        message: 'topics must include primaryTopic',
      });
    }

    const visible = problem.testCases.filter((test) => test.visibility !== 'hidden');
    const hidden = problem.testCases.filter((test) => test.visibility === 'hidden');
    if (visible.length < 2) {
      context.addIssue({
        code: 'custom',
        path: ['testCases'],
        message: 'Need two visible tests.',
      });
    }
    if (hidden.length < 3) {
      context.addIssue({
        code: 'custom',
        path: ['testCases'],
        message: 'Need three hidden tests.',
      });
    }

    for (const required of ['minimum', 'maximum', 'adversarial'] as const) {
      if (!problem.testCases.some((test) => test.coverage === required)) {
        context.addIssue({
          code: 'custom',
          path: ['testCases'],
          message: `Missing ${required} coverage.`,
        });
      }
    }

    if (
      problem.companies.some(
        (association) =>
          association.evidenceType !== 'company_pattern' ||
          association.sourceUrl !== null ||
          association.reportCount !== 0,
      )
    ) {
      context.addIssue({
        code: 'custom',
        path: ['companies'],
        message: 'Generated associations must be honest COMPANY_PATTERN entries only.',
      });
    }

    if (
      Object.keys(problem.languages).sort().join(',') !==
      [...EXECUTION_LANGUAGES].sort().join(',')
    ) {
      context.addIssue({
        code: 'custom',
        path: ['languages'],
        message: 'Every supported language must be present exactly once.',
      });
    }
  })
  /*
   * Expansion happens here, inside parsing, so it has exactly one gateway.
   *
   * Every consumer downstream — validateNativeLibrary, the importer, the
   * reference validator — receives the same fully-populated object it received
   * before shapes existed. The importer then writes that expanded text into
   * `problem_language_templates` as it always has, which is why this needed no
   * migration and why the live execution path never sees a shape: it reads
   * those rows, not this file.
   */
  .transform((problem) => ({
    ...problem,
    languages: expandShape(problem.shape, problem.languages),
  }));

export const nativeProblemBatchSchema = z.object({
  schemaVersion: z.literal(1),
  batch: z.number().int().min(1).max(100),
  reviewStatus: z.literal('needs_review'),
  problems: z.array(nativeProblemSchema).min(1).max(10),
});

export type NativeProblem = z.infer<typeof nativeProblemSchema>;
export type NativeProblemBatch = z.infer<typeof nativeProblemBatchSchema>;

export type NativeLibrarySummary = {
  total: number;
  difficulty: Record<'easy' | 'medium' | 'hard', number>;
  primaryTopics: Record<string, number>;
};

export function validateNativeLibrary(
  batches: readonly NativeProblemBatch[],
): NativeLibrarySummary {
  const batchNumbers = new Set<number>();
  const slugs = new Set<string>();
  const titles = new Set<string>();
  const difficulty = { easy: 0, medium: 0, hard: 0 };
  const primaryTopics: Record<string, number> = Object.fromEntries(
    NATIVE_TOPIC_SLUGS.map((topic) => [topic, 0]),
  );

  for (const batch of batches) {
    if (batchNumbers.has(batch.batch))
      throw new Error(`Duplicate batch number ${batch.batch}.`);
    batchNumbers.add(batch.batch);

    for (const problem of batch.problems) {
      if (slugs.has(problem.slug)) throw new Error(`Duplicate problem slug ${problem.slug}.`);
      if (titles.has(problem.title.toLocaleLowerCase())) {
        throw new Error(`Duplicate problem title ${problem.title}.`);
      }
      slugs.add(problem.slug);
      titles.add(problem.title.toLocaleLowerCase());
      difficulty[problem.difficulty] += 1;
      primaryTopics[problem.primaryTopic] = (primaryTopics[problem.primaryTopic] ?? 0) + 1;
    }
  }

  const total = [...slugs].length;
  if (total !== 100)
    throw new Error(`Native library must contain exactly 100 problems; found ${total}.`);

  for (const [level, expected] of Object.entries(NATIVE_DIFFICULTY_DISTRIBUTION)) {
    const actual = difficulty[level as keyof typeof difficulty];
    if (actual !== expected)
      throw new Error(`${level}: expected ${expected}, found ${actual}.`);
  }

  for (const [topic, expected] of Object.entries(NATIVE_TOPIC_DISTRIBUTION)) {
    const actual = primaryTopics[topic] ?? 0;
    if (actual !== expected)
      throw new Error(`${topic}: expected ${expected}, found ${actual}.`);
  }

  return { total, difficulty, primaryTopics };
}
