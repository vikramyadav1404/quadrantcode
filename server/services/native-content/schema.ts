import { z } from 'zod';
import { EVIDENCE_TYPES, PROBLEM_TYPES, TEST_CASE_VISIBILITIES } from '@/lib/native/constants';
import { EXECUTION_LANGUAGES, type ExecutionLanguage } from '@/lib/execution/languages';
import { WRAPPER_SHAPES, WRAPPER_SHAPE_IDS, type WrapperShapeId } from './wrapper-shapes';

/*
 * Floors for the ACTIVE library, re-based on 2026-09-22.
 *
 * These were 15/10/8/8/7/12/8/12/8/12 and 35/45/20 — a distribution over 100
 * records. That was never 100 problems: 94 of them were ten tasks reskinned,
 * with the same reference solution, the same contract and the same worked
 * example under different titles, labelled easy AND medium AND hard. The 84
 * duplicates now live in `retired/`, which nothing loads.
 *
 * So the old floors measured a population that no longer exists, and were
 * unmeetable by construction: 35 easy problems cannot come out of a 16-problem
 * library. They are re-based on what is actually here.
 *
 * They remain FLOORS, for the reason the previous comment gave: they stop a
 * topic or difficulty being starved without pinning the library to a size.
 * Topic floors are 1 because with 16 problems across 10 topics, "at least one"
 * is the only honest reading of "not starved" — raise them as the library grows
 * rather than pretending a shape it does not have.
 *
 * `medium` is 4 rather than the 6 it will eventually support: four difficulty
 * corrections are still deferred behind the shape work (connected components
 * and subset-sum both move up), so today's count is 5. A floor that a correct
 * library fails is worse than a loose one.
 *
 * ## The two tables must sum to the same number
 *
 * Every problem carries exactly one primary topic and exactly one difficulty,
 * so a library sitting exactly on both sets of floors has to have the same size
 * measured either way. The old constants held this (both summed to 100) and the
 * schema fixture relies on it to build the tightest library that still passes.
 * Both sum to 12 here. `tests/native-content/schema.test.ts` asserts it, so
 * changing one table without the other fails rather than producing a fixture
 * that cannot satisfy itself.
 *
 * The two topics at 2 are the ones the active library actually has most of.
 */
export const NATIVE_TOPIC_DISTRIBUTION = {
  'arrays-hashing': 2,
  'two-pointers-sliding-window': 1,
  'binary-search': 1,
  'stack-queue': 1,
  'linked-list': 1,
  'trees-bst': 1,
  'heap-greedy': 1,
  graphs: 1,
  'backtracking-trie-bit': 1,
  'dynamic-programming': 2,
} as const;

export const NATIVE_DIFFICULTY_DISTRIBUTION = {
  easy: 5,
  medium: 4,
  hard: 3,
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
  /*
   * Ceilings raised from 100 batches of 10 — which was the other half of the
   * hundred-problem lock — to 1000 batches of 100. Generous rather than
   * unbounded: a bound still catches a typo like `batch: 99999`, and 100,000
   * problems is well past anything planned.
   */
  batch: z.number().int().min(1).max(1_000),
  reviewStatus: z.literal('needs_review'),
  problems: z.array(nativeProblemSchema).min(1).max(100),
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

  /*
   * Batch numbers must run 1..N with no gap.
   *
   * `loadNativeProblemBatches` globs `batch-*.json` rather than walking a fixed
   * 1..10 range, which is what allows the library to grow. The fixed range had
   * one accidental virtue: a deleted or misnamed file threw ENOENT. A glob
   * would simply not see it, and the library would validate happily while
   * missing a tenth of itself. Contiguity replaces that guarantee, and is
   * stricter than what it replaces because it also catches a duplicate-free
   * but wrongly-numbered set.
   */
  const numbers = [...batchNumbers].sort((left, right) => left - right);
  for (const [index, number] of numbers.entries()) {
    if (number !== index + 1) {
      throw new Error(
        `Batch numbers must be contiguous from 1; found ${numbers.join(', ')}. ` +
          'A missing or misnamed batch file is the usual cause.',
      );
    }
  }

  const total = [...slugs].length;
  if (total < 1) throw new Error('Native library must contain at least one problem.');

  /*
   * Floors, not exact counts.
   *
   * These were equalities, which pinned the library to exactly 100 problems
   * three times over — once on the total and once per entry in each
   * distribution — and made adding a single problem impossible. The constants
   * are now minimums: no topic or difficulty may be starved, and the library
   * may grow without bound above them.
   *
   * A floor stops meaning much once the library is several times larger than
   * the constants. The alternative considered was proportions with a tolerance,
   * which keeps its meaning at scale but constrains the ORDER of authoring:
   * problems would have to arrive in roughly balanced groups rather than one at
   * a time. Floors were chosen deliberately for that reason. If the library
   * does drift lopsided, proportions are the thing to reach for.
   */
  for (const [level, minimum] of Object.entries(NATIVE_DIFFICULTY_DISTRIBUTION)) {
    const actual = difficulty[level as keyof typeof difficulty];
    if (actual < minimum)
      throw new Error(`${level}: expected at least ${minimum}, found ${actual}.`);
  }

  for (const [topic, minimum] of Object.entries(NATIVE_TOPIC_DISTRIBUTION)) {
    const actual = primaryTopics[topic] ?? 0;
    if (actual < minimum)
      throw new Error(`${topic}: expected at least ${minimum}, found ${actual}.`);
  }

  return { total, difficulty, primaryTopics };
}
