/**
 * F2.2 · the speed-mode target.
 *
 * Pure. The ticket's rule is `min(previous best, estimate)`: the lower bar of
 * "what you have already done" and "what the problem should take". Either may
 * be missing — a problem solved once has a best, a problem never timed does
 * not — and the rule degrades to whichever exists. `estimatedMinutes` is NOT
 * NULL on `problems`, so there is always at least the estimate.
 */
export function speedTargetSeconds(input: {
  bestTimeSeconds: number | null;
  estimatedMinutes: number;
}): number {
  const estimate = input.estimatedMinutes * 60;
  if (input.bestTimeSeconds === null || input.bestTimeSeconds <= 0) return estimate;
  return Math.min(input.bestTimeSeconds, estimate);
}

/**
 * Whether a finished speed sitting met its target.
 *
 * A sitting that ended stuck did not meet it however fast it was: finishing
 * quickly without solving is not the thing being practised.
 */
export function speedTargetMet(input: {
  outcome: 'solved' | 'stuck';
  activeSeconds: number;
  targetSeconds: number;
}): boolean {
  return input.outcome === 'solved' && input.activeSeconds <= input.targetSeconds;
}
