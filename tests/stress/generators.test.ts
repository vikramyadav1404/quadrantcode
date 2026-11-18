/**
 * The inputs "find a small failing case" makes, and the in-process reference
 * runner that answers them.
 *
 * Every generator is run against its problem's own JavaScript reference: an
 * input outside the constraints tends to crash or hang it, and the runner is
 * checked against the stored expected outputs, so the two vouch for each other.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { loadNativeProblemBatches } from '@/server/services/native-content';
import { outputsMatch } from '@/server/services/execution/native';
import {
  STRESS_GENERATORS,
  createRng,
  shrinkCandidates,
  toStdin,
} from '@/server/services/stress/generators';
import { ReferenceRunError, runReference } from '@/server/services/stress/reference';

type Problem = Awaited<ReturnType<typeof loadNativeProblemBatches>>[number]['problems'][number];
let library: Problem[] = [];

beforeAll(async () => {
  library = (await loadNativeProblemBatches()).flatMap((batch) => batch.problems);
}, 60_000);

const javascript = (problem: Problem) => problem.languages.javascript;

describe('stress generators', () => {
  it('cover exactly the problems in the library', () => {
    expect(Object.keys(STRESS_GENERATORS).sort()).toEqual(
      library.map((problem) => problem.slug).sort(),
    );
  });

  it('are deterministic for a seed', () => {
    for (const generator of Object.values(STRESS_GENERATORS)) {
      expect(generator.generate(createRng(42), 5)).toEqual(
        generator.generate(createRng(42), 5),
      );
    }
  });

  it('produce small integer inputs every reference answers', () => {
    for (const problem of library) {
      const generator = STRESS_GENERATORS[problem.slug]!;
      for (let seed = 0; seed < 25; seed += 1) {
        const values = generator.generate(createRng(seed), 1 + (seed % 8));
        expect(values.every(Number.isSafeInteger), problem.slug).toBe(true);
        expect(values.length, problem.slug).toBeLessThanOrEqual(32);
        const output = runReference({ ...javascript(problem), stdin: toStdin(values) });
        expect(() => JSON.parse(output), `${problem.slug} ${toStdin(values)}`).not.toThrow();
      }
    }
  });

  it('shrink only problems whose items are independent, never below the minimum', () => {
    const generator = STRESS_GENERATORS['museum-ticket-pair-count']!;
    expect(shrinkCandidates(generator, [7, 1, 2, 3])).toEqual([
      [7, 2, 3],
      [7, 1, 3],
      [7, 1, 2],
    ]);
    expect(shrinkCandidates(generator, [7])).toEqual([]);
    expect(shrinkCandidates(STRESS_GENERATORS['harbour-lot-echo']!, [4])).toEqual([]);
    expect(shrinkCandidates(STRESS_GENERATORS['clue-trail-loop']!, [1, -1])).toEqual([]);
  });
});

describe('runReference', () => {
  it('reproduces the stored expected output of every test', () => {
    for (const problem of library) {
      for (const test of problem.testCases.filter((item) => !item.isPerformance)) {
        const output = runReference({ ...javascript(problem), stdin: test.input }, 5_000);
        expect(
          outputsMatch(output, test.expectedOutput),
          `${problem.slug}: ${test.input}`,
        ).toBe(true);
      }
    }
  }, 120_000);

  it('gives the reference no module but its fake fs, and stops a runaway loop', () => {
    const wrapperTemplate = '/*__USER_CODE__*/';
    expect(() =>
      runReference({
        wrapperTemplate,
        referenceSolution: 'require("child_process")',
        stdin: '',
      }),
    ).toThrow(ReferenceRunError);
    expect(() =>
      runReference({ wrapperTemplate, referenceSolution: 'while (true) {}', stdin: '' }, 50),
    ).toThrow(ReferenceRunError);
    expect(() =>
      runReference({ wrapperTemplate, referenceSolution: 'process.exit(1)', stdin: '' }),
    ).toThrow(ReferenceRunError);
  });
});
