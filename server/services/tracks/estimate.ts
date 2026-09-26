/**
 * F4.2 · time remaining, from THIS user's measured speed. Pure.
 *
 * The ticket: "estimated time remaining derived from THIS user's average speed
 * on comparable difficulty". For every problem the user has solved, their best
 * ACTIVE time (F1.4, event-derived) is divided by the problem's estimate; the
 * mean of those ratios, per difficulty, scales the estimate of each unsolved
 * problem of the same difficulty.
 *
 * A difficulty the user has no solves in borrows their overall ratio; a user
 * with no solves at all gets the plain estimates, and the page says so rather
 * than presenting a guess as a measurement.
 */

type Difficulty = 'easy' | 'medium' | 'hard';

export type SpeedSample = {
  difficulty: Difficulty;
  bestSeconds: number;
  estimatedMinutes: number;
};

export type SpeedProfile = {
  byDifficulty: Partial<Record<Difficulty, number>>;
  overall: number | null;
};

export function speedProfile(samples: readonly SpeedSample[]): SpeedProfile {
  const usable = samples.filter(
    (sample) => sample.bestSeconds > 0 && sample.estimatedMinutes > 0,
  );
  const ratio = (sample: SpeedSample) => sample.bestSeconds / (sample.estimatedMinutes * 60);
  const mean = (values: number[]) =>
    values.reduce((sum, value) => sum + value, 0) / values.length;

  const byDifficulty: Partial<Record<Difficulty, number>> = {};
  for (const difficulty of ['easy', 'medium', 'hard'] as const) {
    const ratios = usable.filter((sample) => sample.difficulty === difficulty).map(ratio);
    if (ratios.length > 0) byDifficulty[difficulty] = mean(ratios);
  }
  return { byDifficulty, overall: usable.length > 0 ? mean(usable.map(ratio)) : null };
}

export function remainingMinutes(
  unsolved: readonly { difficulty: Difficulty; estimatedMinutes: number }[],
  profile: SpeedProfile,
): number {
  const total = unsolved.reduce((sum, problem) => {
    const factor = profile.byDifficulty[problem.difficulty] ?? profile.overall ?? 1;
    return sum + problem.estimatedMinutes * factor;
  }, 0);
  return Math.round(total);
}
