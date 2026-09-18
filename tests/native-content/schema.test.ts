import { describe, expect, it } from 'vitest';
import { EXECUTION_LANGUAGES } from '@/lib/execution/languages';
import {
  NATIVE_DIFFICULTY_DISTRIBUTION,
  NATIVE_TOPIC_DISTRIBUTION,
  nativeProblemBatchSchema,
  validateNativeLibrary,
} from '@/server/services/native-content/schema';

/*
 * A record now supplies only its reference solution per language. The other
 * seven fields are the shape's, expanded during parsing — see
 * `server/services/native-content/wrapper-shapes.ts`. This fixture used to
 * spell all eight out, which is the duplication the shape registry removed.
 */
function fixtureLanguage(_language: (typeof EXECUTION_LANGUAGES)[number]) {
  return {
    referenceSolution: 'function solve(values) { return values.length; }',
  } as const;
}

function libraryFixture() {
  const topics = Object.entries(NATIVE_TOPIC_DISTRIBUTION).flatMap(([topic, count]) =>
    Array.from({ length: count }, () => topic),
  );

  const difficulties = Object.entries(NATIVE_DIFFICULTY_DISTRIBUTION).flatMap(
    ([difficulty, count]) => Array.from({ length: count }, () => difficulty),
  );

  const problems = topics.map((topic, index) => ({
    slug: `original-fixture-${String(index + 1).padStart(3, '0')}`,
    title: `Original Fixture ${String(index + 1).padStart(3, '0')}`,
    difficulty: difficulties[index],
    primaryTopic: topic,
    topics: [topic],
    problemType: 'function',
    shape: 'int-array-to-int',
    version: 1,
    status: 'needs_review',
    estimatedMinutes: 30,
    difficultyCalibration: 0,
    story: 'A small independent story gives this original validation fixture enough context.',
    statement:
      'Given a JSON array of integers, return its length. This wording is created only for validating the structured native content contract.',
    inputFormat: 'The function receives one JSON array containing zero or more integer values.',
    outputFormat:
      'Return one JSON integer equal to the number of values in the supplied array.',
    functionContract: {
      functionName: 'solve',
      parameters: [
        { name: 'values', type: 'integer[]', description: 'The input integer values.' },
      ],
      returnType: 'integer',
    },
    constraints: [
      '0 <= values.length <= 100000',
      '-100000 <= values[i] <= 100000',
      'Input is valid JSON.',
    ],
    examples: [
      {
        input: '[1,2,3]',
        output: '3',
        explanation:
          'The input contains exactly three values, so the returned length is three.',
      },
      {
        input: '[]',
        output: '0',
        explanation: 'The empty input contains no values, so the returned length is zero.',
      },
    ],
    testCases: [
      {
        visibility: 'sample',
        input: '[1,2,3]',
        expectedOutput: '3',
        coverage: 'sample',
        isPerformance: false,
      },
      {
        visibility: 'visible',
        input: '[]',
        expectedOutput: '0',
        coverage: 'empty',
        isPerformance: false,
      },
      {
        visibility: 'hidden',
        input: '[7]',
        expectedOutput: '1',
        coverage: 'minimum',
        isPerformance: false,
      },
      {
        visibility: 'hidden',
        input: '[1,1]',
        expectedOutput: '2',
        coverage: 'duplicates',
        isPerformance: false,
      },
      {
        visibility: 'hidden',
        input: '[0,1,2,3]',
        expectedOutput: '4',
        coverage: 'maximum',
        isPerformance: true,
      },
      {
        visibility: 'hidden',
        input: '[-1,0,1]',
        expectedOutput: '3',
        coverage: 'adversarial',
        isPerformance: false,
      },
    ],
    timeLimitMs: 2_000,
    memoryLimitKb: 128_000,
    hints: [
      'The array object already records how many elements it contains.',
      'No scan is required when the language exposes a constant-time length property.',
    ],
    editorial: {
      overview:
        'The task checks the basic function contract and JSON serialization used by native problems.',
      bruteForceApproach:
        'A loop can increment a counter once for every element in the supplied array.',
      optimalApproach:
        'Read the array length maintained by the runtime and return it directly in constant time.',
      correctnessProof:
        'The runtime length equals the number of indexed elements by definition, so returning it gives exactly the requested count for every valid array.',
      timeComplexity: 'O(1)',
      spaceComplexity: 'O(1)',
    },
    languages: Object.fromEntries(
      EXECUTION_LANGUAGES.map((language) => [language, fixtureLanguage(language)]),
    ),
    provenance: {
      contentSource: 'quadrantcode-original',
      independentlyCreated: true,
      licenseName: 'Quadrantcode Original Content License',
      licenseUrl: null,
      author: 'Quadrantcode editorial team',
      note: 'Created independently as a local schema fixture; no external problem text was used.',
    },
    companies: [
      {
        companySlug: 'amazon',
        evidenceType: 'company_pattern',
        role: null,
        round: null,
        candidateLevel: null,
        yearFrom: null,
        yearTo: null,
        location: null,
        sourceUrl: null,
        reportCount: 0,
        confidenceScore: 0,
        verificationStatus: 'unverified',
        lastReviewedDate: null,
      },
    ],
  }));

  return Array.from({ length: 10 }, (_, index) =>
    nativeProblemBatchSchema.parse({
      schemaVersion: 1,
      batch: index + 1,
      reviewStatus: 'needs_review',
      problems: problems.slice(index * 10, index * 10 + 10),
    }),
  );
}

describe('native problem content schema', () => {
  it('enforces the exact 100-problem distributions and all language templates', () => {
    expect(validateNativeLibrary(libraryFixture())).toEqual({
      total: 100,
      difficulty: NATIVE_DIFFICULTY_DISTRIBUTION,
      primaryTopics: NATIVE_TOPIC_DISTRIBUTION,
    });
  });

  it('rejects an incomplete aggregate library', () => {
    const batches = libraryFixture();
    batches[9] = { ...batches[9]!, problems: batches[9]!.problems.slice(0, 9) };
    expect(() => validateNativeLibrary(batches)).toThrow('exactly 100');
  });

  it('rejects fabricated verified evidence in generated batches', () => {
    const problem = libraryFixture()[0]!.problems[0]!;
    expect(() =>
      nativeProblemBatchSchema.parse({
        schemaVersion: 1,
        batch: 1,
        reviewStatus: 'needs_review',
        problems: [
          {
            ...problem,
            companies: [
              {
                ...problem.companies[0],
                evidenceType: 'verified_pyq',
                sourceUrl: 'https://example.com/evidence',
                verificationStatus: 'verified',
              },
            ],
          },
        ],
      }),
    ).toThrow('COMPANY_PATTERN');
  });
});
