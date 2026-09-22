/**
 * Feature flags (F0.1 requirement 4).
 *
 * Every flag is env-driven and defaults to `false`. A flag is only flipped to
 * `true` once its ticket's acceptance criteria pass — see README §Feature flags.
 *
 * Flag names are a closed union so a typo is a compile error rather than a
 * silently-disabled feature.
 */

import type { EnvSource } from './env';

/*
 * Ten flags were deleted on 2026-09-16. A flag that gates nothing is worse than
 * no flag: it implies a control that does not exist, and `/admin/health`
 * rendered all fifteen as though each were a working switch.
 *
 * Seven belonged to cut tickets with no code to gate at all — FEATURE_AI
 * (F3.4), FEATURE_BILLING (F4.4), FEATURE_COINS (F4.3), FEATURE_CONTESTS
 * (F2.5), FEATURE_NOTIFICATIONS (F2.4), FEATURE_REVISION_MODES (F2.2) and
 * FEATURE_TRACKS (F4.2). Re-add one with its ticket, not before.
 *
 * Three guarded features that shipped and are stable — FEATURE_STREAK_ENGINE
 * (F1.3), FEATURE_STUCK_INFERENCE (F3.3) and FEATURE_MISTAKE_MEMORY (F3.5).
 * None was ever read. A kill switch nobody reads is not a kill switch.
 *
 * What remains is every flag that is enforced, plus two held deliberately
 * unwired with the reason recorded in `docs/status.md`.
 */
export const FEATURE_FLAGS = [
  'FEATURE_PHONE_OTP', // F0.3 auth-verification — enforced
  'FEATURE_EXECUTION', // F3.1 execution-pipeline — enforced
  'FEATURE_MOCKS', // F4.5 mock-assessment — enforced
  'FEATURE_TIMELINE', // F3.2 solve-timeline — NOT wired; see docs/status.md
  // Gates originals out of list, search AND detail — all three doors, because
  // a gate on one is a gate the other two route around. `/admin/problems`
  // opts back in explicitly, since review is how an original gets published.
  'FEATURE_ORIGINAL_PROBLEMS', // F4.1 authoring-cms — enforced
] as const;

export type FeatureFlag = (typeof FEATURE_FLAGS)[number];

/** Only these spellings enable a flag. Anything else — including "1" — is off. */
const TRUTHY = new Set(['true', 'TRUE', 'True']);

/**
 * Reads a flag from an env source. Defaults to `false` when unset, so a
 * forgotten variable in production disables a feature instead of exposing it.
 */
export function isFeatureEnabled(flag: FeatureFlag, source: EnvSource = process.env): boolean {
  return TRUTHY.has(source[flag] ?? '');
}

/** Snapshot of every flag — used by /admin/health and by tests. */
export function allFeatureFlags(source: EnvSource = process.env): Record<FeatureFlag, boolean> {
  return Object.fromEntries(
    FEATURE_FLAGS.map((flag) => [flag, isFeatureEnabled(flag, source)]),
  ) as Record<FeatureFlag, boolean>;
}

/** Throws a typed error when a feature is reached while its flag is off. */
export class FeatureDisabledError extends Error {
  readonly code = 'FEATURE_DISABLED';
  constructor(readonly flag: FeatureFlag) {
    super(`Feature ${flag} is disabled.`);
    this.name = 'FeatureDisabledError';
  }
}

export function assertFeatureEnabled(flag: FeatureFlag, source: EnvSource = process.env): void {
  if (!isFeatureEnabled(flag, source)) throw new FeatureDisabledError(flag);
}
