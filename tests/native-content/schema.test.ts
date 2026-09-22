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

/**
 * The smallest library that still meets every floor.
 *
 * Derived from the constants rather than stated, so re-basing the floors — as
 * happened when the 84 duplicates were retired — moves the fixture with them
 * instead of leaving a test asserting a size the library no longer has.
 */
const FLOOR_TOTAL = Object.values(NATIVE_DIFFICULTY_DISTRIBUTION).reduce(
  (sum, count) => sum + count,
  0,
);

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

  /*
   * Chunked, not a fixed ten batches of ten.
   *
   * The library used to be pinned at 100, so `length: 10` and `slice(i*10)`
   * happened to line up. The floors were re-based on the 16-problem active
   * library in 2026-09-22, and a fixed ten batches now yields eight EMPTY ones,
   * which the schema rejects for `problems: min(1)` before any assertion runs.
   * Chunking keeps the fixture tied to the constants rather than to a size.
   */
  const perBatch = 10;
  const chunks: (typeof problems)[] = [];
  for (let start = 0; start < problems.length; start += perBatch) {
    chunks.push(problems.slice(start, start + perBatch));
  }

  return chunks.map((chunk, index) =>
    nativeProblemBatchSchema.parse({
      schemaVersion: 1,
      batch: index + 1,
      reviewStatus: 'needs_review',
      problems: chunk,
    }),
  );
}

describe('native problem content floors', () => {
  it('the two tables sum to the same number', () => {
    /*
     * Every problem has exactly one primary topic and exactly one difficulty,
     * so a library sitting exactly on both sets of floors must be the same size
     * measured either way — and `libraryFixture` zips the two expansions
     * positionally, so a mismatch silently pairs some problems with
     * `undefined`.
     *
     * Asserted because the constants were re-based by hand in 2026-09-22 and
     * the first attempt broke this: topics summed to 10, difficulties to 12.
     */
    const topics = Object.values(NATIVE_TOPIC_DISTRIBUTION).reduce((a, b) => a + b, 0);
    const difficulties = Object.values(NATIVE_DIFFICULTY_DISTRIBUTION).reduce(
      (a, b) => a + b,
      0,
    );
    expect(topics).toBe(difficulties);
  });

  it('the fixture pairs every problem with a real difficulty', () => {
    // The symptom a mismatch produces, asserted directly.
    for (const batch of libraryFixture()) {
      for (const problem of batch.problems) {
        expect(problem.difficulty).toBeTruthy();
        expect(problem.primaryTopic).toBeTruthy();
      }
    }
  });
});

describe('native problem content schema', () => {
  it('accepts a library that meets every floor, and reports what it found', () => {
    // The fixture is built from the constants, so it sits exactly ON the floors
    // — the tightest library that can still pass. Anything smaller breaches one.
    expect(validateNativeLibrary(libraryFixture())).toEqual({
      total: FLOOR_TOTAL,
      difficulty: NATIVE_DIFFICULTY_DISTRIBUTION,
      primaryTopics: NATIVE_TOPIC_DISTRIBUTION,
    });
  });

  it('rejects a library that has dropped below a floor', () => {
    /*
     * Asserted on 'at least' rather than a named topic. Which floor breaks
     * depends on which problem the slice removes, and pinning that would make
     * the test depend on the fixture's ordering rather than on the rule.
     *
     * This used to assert 'exactly 100'. The library is still rejected — one
     * fewer problem than the floors require is still too few — but the reason
     * is now a floor rather than a total, which is the whole point of the
     * change.
     */
    const batches = libraryFixture();
    const last = batches.length - 1;
    batches[last] = {
      ...batches[last]!,
      problems: batches[last]!.problems.slice(0, batches[last]!.problems.length - 1),
    };
    expect(() => validateNativeLibrary(batches)).toThrow(/expected at least/);
  });

  it('accepts a library grown past the floors', () => {
    /*
     * The case the lock made impossible. An eleventh batch of extra problems
     * must now validate — every floor is still met, and nothing caps the total.
     */
    const batches = libraryFixture();
    const extra = batches[0]!.problems.slice(0, 5).map((problem, index) => ({
      ...problem,
      slug: `original-extra-${String(index + 1).padStart(3, '0')}`,
      title: `Original Extra ${String(index + 1).padStart(3, '0')}`,
    }));

    const grown = [...batches, { ...batches[0]!, batch: batches.length + 1, problems: extra }];
    expect(validateNativeLibrary(grown).total).toBe(FLOOR_TOTAL + extra.length);
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

/*
 * Positive controls for `validateNativeLibrary`, written BEFORE the exact-count
 * checks were relaxed into floors.
 *
 * Removing a check is exactly where a test goes vacuous: a suite that only
 * asserts a good library passes would stay green if the checks were deleted
 * outright. Each case below therefore asserts a REJECTION, and each was run
 * against the strict implementation first:
 *
 *   topic shortfall       rejected before (11 !== 12) and after (11 < 12)
 *   difficulty shortfall  rejected before (34 !== 35) and after (34 < 35)
 *   empty library         rejected before (0 !== 100)  and after (0 < 1)
 *   non-contiguous batch  NOT rejected before — this one failed until the
 *                         contiguity guard was added, which is what proves it
 *                         tests something real rather than restating the code
 *
 * Assertions match on the subject — the topic name, the difficulty level —
 * rather than the full sentence, so they survive the wording change from
 * "expected N" to "expected at least N" without being loosened to `.toThrow()`.
 */
describe('validateNativeLibrary rejects a broken library', () => {
  it('rejects a topic below its floor, even when the total is right', () => {
    const batches = libraryFixture();
    /*
     * Move a problem OUT of `arrays-hashing`, not into it. The total stays 100,
     * so this isolates the per-topic check from the total check.
     *
     * The direction matters, and the first draft had it backwards. Any
     * single-problem move creates both a shortfall and an excess, and the
     * checks run in declaration order with `arrays-hashing` first. Moving a
     * problem INTO it tripped the excess (16 against 15) before reaching the
     * topic that was actually short — which the strict checks reject and floors
     * would not, so the test would have kept passing for a different reason
     * after the relaxation. Making the shortfall land on the first-checked
     * topic means both regimes fail on the same subject.
     */
    const victim = batches
      .flatMap((batch) => batch.problems)
      .find((problem) => problem.primaryTopic === 'arrays-hashing');
    expect(victim).toBeDefined();
    victim!.primaryTopic = 'graphs';

    expect(() => validateNativeLibrary(batches)).toThrow('arrays-hashing');
  });

  it('rejects a difficulty below its floor, even when the total is right', () => {
    const batches = libraryFixture();
    const victim = batches
      .flatMap((batch) => batch.problems)
      .find((problem) => problem.difficulty === 'easy');
    expect(victim).toBeDefined();
    victim!.difficulty = 'medium';

    expect(() => validateNativeLibrary(batches)).toThrow('easy');
  });

  it('rejects an empty library', () => {
    expect(() => validateNativeLibrary([])).toThrow();
  });

  it('rejects a gap in the batch numbers', () => {
    // The loader globs `batch-*.json`, so a deleted or misnamed file would
    // simply not be read. The fixed 1..10 range used to throw ENOENT for that;
    // contiguity is what replaces it.
    const batches = libraryFixture();
    batches[batches.length - 1] = { ...batches[batches.length - 1]!, batch: 11 };

    expect(() => validateNativeLibrary(batches)).toThrow('contiguous');
  });
});
