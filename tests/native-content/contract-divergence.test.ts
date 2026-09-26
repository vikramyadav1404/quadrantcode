import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { EXECUTION_LANGUAGES } from '@/lib/execution/languages';
import { loadNativeProblemBatches } from '@/server/services/native-content';
import {
  findContractDivergence,
  nativeProblemSchema,
} from '@/server/services/native-content/schema';
import { WRAPPER_SHAPES } from '@/server/services/native-content/wrapper-shapes';

/*
 * D33: the statement panel renders `functionContract`, the editor renders the
 * expanded `functionSignature`, and the two must never describe different
 * functions.
 *
 * Before shape 1 this would have passed for the wrong reason — every record and
 * every shape said `solve(values)`, so they agreed by being equally generic. So
 * the agreement test runs on records whose names are NOT `solve`, and every
 * rejection path has a positive control proving it fires.
 */

type RawRecord = Record<string, unknown> & {
  slug: string;
  functionContract: { functionName: string; parameters: { name: string }[] };
};

/** The unparsed record, as authored — the schema's input, not its output. */
function rawRecord(slug: string): RawRecord {
  const batch = JSON.parse(readFileSync('data/native-problems/batch-01.json', 'utf8')) as {
    problems: RawRecord[];
  };
  const record = batch.problems.find((problem) => problem.slug === slug);
  if (!record) throw new Error(`fixture record missing: ${slug}`);
  return structuredClone(record);
}

describe('the panel and the editor name the same function', () => {
  it('agree for every record in the library, including ones not called solve', async () => {
    const problems = (await loadNativeProblemBatches()).flatMap((batch) => batch.problems);

    for (const problem of problems) {
      expect(
        findContractDivergence(problem.functionContract, problem.languages),
        problem.slug,
      ).toEqual([]);
    }

    // The non-vacuity condition: agreement is only evidence when the names differ
    // from the generic ones both sides used to share by accident.
    const descriptive = problems.filter(
      (problem) => problem.functionContract.functionName !== 'solve',
    );
    expect(descriptive.map((problem) => problem.slug).sort()).toEqual([
      'donation-target-subsets',
      'ferry-weight-rating',
      'kiln-soak-window',
      'museum-ticket-pair-count',
      'pipeline-segment-from-end',
      'sorted-dock-insertion',
    ]);
  });

  it('expands countPairs(prices, target) into every language, wrapper included', async () => {
    const problem = (await loadNativeProblemBatches())
      .flatMap((batch) => batch.problems)
      .find((candidate) => candidate.slug === 'museum-ticket-pair-count')!;

    expect(problem.languages.python3.functionSignature).toBe(
      'def countPairs(prices: list[int], target: int) -> int',
    );
    for (const language of EXECUTION_LANGUAGES) {
      const template = problem.languages[language];
      expect(template.starterCode, language).toContain('countPairs');
      // The wrapper calls the solver by name; a stale name would not compile.
      expect(template.wrapperTemplate, language).toContain('countPairs(');
      expect(template.wrapperTemplate, language).not.toMatch(/__FN__|__P\d__/);
    }
  });
});

describe('findContractDivergence rejects a disagreement (positive control)', () => {
  it('reports every name the old generic signature does not carry, in every language', () => {
    const contract = rawRecord('museum-ticket-pair-count').functionContract;
    const genericEditor = Object.fromEntries(
      EXECUTION_LANGUAGES.map((language) => [
        language,
        {
          functionSignature: WRAPPER_SHAPES['int-array-to-int'][language].functionSignature
            .replaceAll('__FN__', 'solve')
            .replaceAll('__P1__', 'values'),
        },
      ]),
    ) as Parameters<typeof findContractDivergence>[1];

    const divergences = findContractDivergence(contract, genericEditor);
    // countPairs, prices and target, missing from each of five signatures.
    expect(divergences).toHaveLength(3 * EXECUTION_LANGUAGES.length);
    expect(divergences.join('\n')).toContain('does not name countPairs');
    expect(divergences.join('\n')).toContain('does not name target');
  });

  it('does not match a name that only appears inside a longer identifier', () => {
    // `\b` matters: a contract naming `price` must not be satisfied by `prices`.
    const signature = {
      functionSignature: 'long long countPairs(const vector<long long>& prices)',
    };
    const languages = Object.fromEntries(
      EXECUTION_LANGUAGES.map((language) => [language, signature]),
    ) as Parameters<typeof findContractDivergence>[1];

    expect(
      findContractDivergence(
        { functionName: 'countPairs', parameters: [{ name: 'price' }] },
        languages,
      ),
    ).toHaveLength(EXECUTION_LANGUAGES.length);
  });
});

describe('the schema refuses a record the panel and editor would disagree about', () => {
  const originalSignature = WRAPPER_SHAPES['int-array-int-to-int'].javascript.functionSignature;
  afterEach(() => {
    (
      WRAPPER_SHAPES['int-array-int-to-int'].javascript as { functionSignature: string }
    ).functionSignature = originalSignature;
  });

  it('accepts the unmodified record, so the rejections below are about the change', () => {
    expect(nativeProblemSchema.safeParse(rawRecord('museum-ticket-pair-count')).success).toBe(
      true,
    );
  });

  it('rejects a shape template that hard-codes a name instead of taking the record’s', () => {
    // The failure the placeholders exist to prevent, reintroduced in one language.
    (
      WRAPPER_SHAPES['int-array-int-to-int'].javascript as { functionSignature: string }
    ).functionSignature = 'function solve(__P1__, __P2__)';

    const result = nativeProblemSchema.safeParse(rawRecord('museum-ticket-pair-count'));
    expect(result.success).toBe(false);
    expect(result.error!.issues.map((issue) => issue.message)).toContain(
      'javascript signature "function solve(prices, target)" does not name countPairs.',
    );
  });

  it('rejects a contract naming more parameters than the shape takes', () => {
    const record = rawRecord('museum-ticket-pair-count');
    record.functionContract.parameters.push({
      name: 'budget',
      type: 'integer',
      description: 'A third argument no wrapper passes.',
    } as { name: string });

    const result = nativeProblemSchema.safeParse(record);
    expect(result.success).toBe(false);
    expect(result.error!.issues[0]!.path).toEqual(['functionContract', 'parameters']);
    expect(result.error!.issues[0]!.message).toContain(
      'takes 2 parameter(s); the contract names 3',
    );
  });

  it('rejects a contract naming fewer, as a schema issue rather than a raw throw', () => {
    const record = rawRecord('museum-ticket-pair-count');
    record.functionContract.parameters.pop();

    // safeParse must RETURN the failure: a throw here would mean expansion ran
    // on a record the arity check had already refused.
    const result = nativeProblemSchema.safeParse(record);
    expect(result.success).toBe(false);
    expect(result.error!.issues[0]!.message).toContain('the contract names 1');
  });

  it('rejects a name that is not an identifier, since names are spliced into code', () => {
    const record = rawRecord('museum-ticket-pair-count');
    record.functionContract.functionName = 'count pairs';

    const result = nativeProblemSchema.safeParse(record);
    expect(result.success).toBe(false);
    expect(result.error!.issues.map((issue) => issue.message)).toContain(
      '"count pairs" is not an identifier.',
    );
  });
});
