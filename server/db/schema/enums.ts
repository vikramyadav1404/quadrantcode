/**
 * Shared Postgres enums.
 *
 * Every taxonomy that a WHERE clause will filter on lives here as a real
 * Postgres enum rather than free text or a JSON key — F1.5's storage rule
 * ("queryable with a WHERE clause on an enum column") starts at this file.
 */
import { pgEnum } from 'drizzle-orm/pg-core';

/** RBAC roles. `requireRole()` in F0.3 reads this. */
export const userRoleEnum = pgEnum('user_role', ['user', 'admin']);

/** How a verification code was delivered. */
export const verificationMethodEnum = pgEnum('verification_method', ['email', 'phone']);

/**
 * C1: an `external_link` problem stores metadata and a URL only. `original`
 * problems are 100% our own text (C2) and are authored through F4.1.
 */
export const problemSourceTypeEnum = pgEnum('problem_source_type', [
  'external_link',
  'original',
]);

export const difficultyEnum = pgEnum('difficulty', ['easy', 'medium', 'hard']);

/**
 * F4.1's quality workflow. F0.2 only ever produces 'published' rows, but the
 * full ladder is declared now so adding the gate later is not a type change.
 */
export const problemStatusEnum = pgEnum('problem_status', [
  'draft',
  'review',
  'tested',
  'published',
  'archived',
]);

/**
 * C3: company tags are always "-style" values (e.g. 'faang-style'), never a
 * claim that a problem is an actual company question.
 */
export const problemTagTypeEnum = pgEnum('problem_tag_type', [
  'topic',
  'pattern',
  'company_style',
]);

/** A user's relationship with a problem. Drives the catalog status filter. */
export const userProblemStatusEnum = pgEnum('user_problem_status', [
  'not_started',
  'in_progress',
  'solved',
  'stuck',
  'needs_revision',
]);

/**
 * Target role a user is preparing for (F0.3 onboarding, F0.5 profile).
 *
 * A closed enum rather than free text: F4.2 selects preparation tracks from it,
 * and a track lookup against typo'd free text silently returns nothing. Adding
 * a value later is a one-line migration; cleaning up dirty free text is not.
 */
export const targetRoleEnum = pgEnum('target_role', [
  'sde_intern',
  'sde_1',
  'quant',
  'hft',
  'other',
]);

/** Self-reported confidence, reused by reflections (F1.5) and revision (F2.1). */
export const confidenceEnum = pgEnum('confidence', ['low', 'medium', 'high']);

/**
 * F1.2 import job lifecycle.
 *
 * `stalled` exists because the in-process runner cannot survive a deploy or a
 * serverless suspend (see D17). A job whose heartbeat has gone quiet is
 * distinguishable from one that genuinely failed, which matters: the remedy for
 * a stalled job is to resume it, and for a failed one is to fix the file.
 */
export const importJobStatusEnum = pgEnum('import_job_status', [
  'pending',
  'running',
  'succeeded',
  'partial',
  'failed',
  'stalled',
]);

/**
 * The outcome of one CSV row.
 *
 * `duplicate` is deliberately not `failed`: re-importing a list you already
 * have is the normal case, not an error, and the two must be counted
 * separately or the idempotency criterion cannot be asserted.
 */
export const importRowOutcomeEnum = pgEnum('import_row_outcome', [
  'created',
  'linked',
  'duplicate',
  'invalid',
]);
