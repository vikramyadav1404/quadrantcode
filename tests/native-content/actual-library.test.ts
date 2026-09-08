import { describe, expect, it } from 'vitest';
import { EXECUTION_LANGUAGES } from '@/lib/execution/languages';
import {
  NATIVE_DIFFICULTY_DISTRIBUTION,
  NATIVE_TOPIC_DISTRIBUTION,
  loadNativeProblemBatches,
  validateNativeLibrary,
} from '@/server/services/native-content';

describe('generated native problem files', () => {
  it('validate as ten reviewable batches with complete secure templates', async () => {
    const batches = await loadNativeProblemBatches();
    expect(batches).toHaveLength(10);
    expect(batches.every((batch) => batch.problems.length === 10)).toBe(true);
    expect(validateNativeLibrary(batches)).toEqual({
      total: 100,
      difficulty: NATIVE_DIFFICULTY_DISTRIBUTION,
      primaryTopics: NATIVE_TOPIC_DISTRIBUTION,
    });
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
