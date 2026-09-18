import { describe, expect, it } from 'vitest';
import { EXECUTION_LANGUAGES } from '@/lib/execution/languages';
import {
  NATIVE_DIFFICULTY_DISTRIBUTION,
  NATIVE_TOPIC_DISTRIBUTION,
  loadNativeProblemBatches,
  validateNativeLibrary,
} from '@/server/services/native-content';

describe('generated native problem files', () => {
  it('validate as reviewable batches with complete secure templates', async () => {
    const batches = await loadNativeProblemBatches();
    const all = batches.flatMap((batch) => batch.problems);

    /*
     * Derived, not hard-coded.
     *
     * This asserted ten batches of exactly ten, totalling 100. Those numbers
     * were the library-size lock restated at the test layer: adding a single
     * problem broke the suite even once the schema allowed it. What actually
     * matters is that the library is non-empty, that the summary agrees with
     * what was loaded, and that every floor is met — which
     * `validateNativeLibrary` already enforces and is proven separately in
     * `schema.test.ts`.
     */
    expect(batches.length).toBeGreaterThan(0);
    expect(all.length).toBeGreaterThan(0);

    const summary = validateNativeLibrary(batches);
    expect(summary.total).toBe(all.length);
    for (const [level, minimum] of Object.entries(NATIVE_DIFFICULTY_DISTRIBUTION)) {
      expect(
        summary.difficulty[level as keyof typeof summary.difficulty],
      ).toBeGreaterThanOrEqual(minimum);
    }
    for (const [topic, minimum] of Object.entries(NATIVE_TOPIC_DISTRIBUTION)) {
      expect(summary.primaryTopics[topic] ?? 0).toBeGreaterThanOrEqual(minimum);
    }
    for (const problem of batches.flatMap((batch) => batch.problems)) {
      expect(Object.keys(problem.languages).sort()).toEqual([...EXECUTION_LANGUAGES].sort());
      expect(problem.status).toBe('needs_review');
      expect(
        problem.companies.every(
          (association) => association.evidenceType === 'company_pattern',
        ),
      ).toBe(true);
      expect(
        problem.companies.every(
          (association) => !association.sourceUrl && association.reportCount === 0,
        ),
      ).toBe(true);
    }
  });
});
