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

export const FEATURE_FLAGS = [
  'FEATURE_PHONE_OTP', // F0.3 auth-verification
  'FEATURE_STREAK_ENGINE', // F1.3 streak-engine
  'FEATURE_REVISION_MODES', // F2.2 revision-modes
  'FEATURE_NOTIFICATIONS', // F2.4 notification-engine
  'FEATURE_CONTESTS', // F2.5 contest-upsolve
  'FEATURE_EXECUTION', // F3.1 execution-pipeline
  'FEATURE_TIMELINE', // F3.2 solve-timeline
  'FEATURE_STUCK_INFERENCE', // F3.3 stuck-inference
  'FEATURE_AI', // F3.4 ai-gateway
  'FEATURE_MISTAKE_MEMORY', // F3.5 mistake-memory
  'FEATURE_ORIGINAL_PROBLEMS', // F4.1 authoring-cms
  'FEATURE_TRACKS', // F4.2 prep-tracks
  'FEATURE_COINS', // F4.3 rewards-trust
  'FEATURE_BILLING', // F4.4 billing
  'FEATURE_MOCKS', // F4.5 mock-assessment
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
