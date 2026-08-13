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

/** Self-reported confidence, reused by reflections (F1.5) and revision (F2.1). */
export const confidenceEnum = pgEnum('confidence', ['low', 'medium', 'high']);
