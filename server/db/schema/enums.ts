/**
 * Shared Postgres enums.
 *
 * Every taxonomy that a WHERE clause will filter on lives here as a real
 * Postgres enum rather than free text or a JSON key — F1.5's storage rule
 * ("queryable with a WHERE clause on an enum column") starts at this file.
 */
import { pgEnum } from 'drizzle-orm/pg-core';
import { MISTAKE_CATEGORIES, STUCK_CATEGORIES, STUCK_SOURCES } from '@/lib/reflection/taxonomy';

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
 * F1.4 solve-session lifecycle.
 *
 * `active` and `paused` are the two live states; the other three are terminal
 * and a session never leaves them. The split matters because "one active
 * session per user" has to mean "one LIVE session" — a paused session is still
 * the user's session, so starting a second one while paused must conflict
 * rather than quietly orphan the first.
 *
 * `stuck` is an outcome, not a state: the user finished the sitting without
 * solving. F1.5 attaches the reflection that explains it.
 */
export const solveSessionStatusEnum = pgEnum('solve_session_status', [
  'active',
  'paused',
  'solved',
  'stuck',
  'abandoned',
]);

/**
 * F1.4's minimal event taxonomy — **designed to be extended, not replaced**.
 *
 * F3.2 turns `session_events` into the full append-only log and adds
 * `statement_viewed`, `first_keystroke`, `code_snapshot`, `run_attempted`,
 * `run_failed`, `run_passed`, `hint_requested`, `stuck_marked`, `idle_started`
 * and `idle_ended`. The names below are deliberately the ones that appear in
 * that later list, so extending this enum is adding values rather than renaming
 * rows that already exist.
 *
 * `idle_autopause` is F1.4's own: it records that the SERVER paused a session
 * the user had walked away from, which is a different fact from the user
 * pressing pause and must stay distinguishable forever.
 */
export const sessionEventTypeEnum = pgEnum('session_event_type', [
  'session_started',
  'paused',
  'resumed',
  'idle_autopause',
  'session_completed',
  'session_abandoned',
  /** F1.5 — the user pressed "I'm stuck". F3.2's taxonomy already names it. */
  'stuck_marked',
]);

/**
 * F1.5 · the reflection taxonomy, as database enums.
 *
 * **Built from `lib/reflection/taxonomy.ts`, not re-typed here.** That file is
 * the single declaration the ticket requires; these three lines are the database
 * reading it. A second hand-written copy would eventually differ from the form's
 * copy, and the symptom is a category the UI offers and Postgres rejects on
 * submit — after the user has typed a paragraph.
 *
 * They are real enums rather than text for the criterion's sake: mistake
 * categories must be queryable with a `WHERE` clause, with no JSON extraction
 * for any taxonomy field.
 */
export const stuckCategoryEnum = pgEnum('stuck_category', STUCK_CATEGORIES);

export const mistakeCategoryEnum = pgEnum('mistake_category', MISTAKE_CATEGORIES);

/** Who identified the stuck point. F1.5 writes only `user`; F3.3 adds `inferred`. */
export const stuckSourceEnum = pgEnum('stuck_source', STUCK_SOURCES);

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

/**
 * F2.1 · which ladder a problem is climbing.
 *
 * Chosen once, when the revision is first scheduled, from the confidence the
 * user reported. Stored rather than re-derived so that changing their mind
 * later does not silently move every interval they have already been given —
 * the same immutability instinct D18 applies to recorded days.
 */
export const ladderKindEnum = pgEnum('ladder_kind', ['standard', 'compressed']);

/**
 * F2.1 · how a revision went.
 *
 * Three outcomes, because the schedule responds differently to each: `clean`
 * advances the ladder, `struggled` repeats the current interval, `failed`
 * resets to day one. Two outcomes would force "struggled" to round to one of
 * the others, and rounding it up is how a user who is barely holding on gets
 * pushed to a 30-day gap.
 */
export const revisionOutcomeEnum = pgEnum('revision_outcome', ['clean', 'struggled', 'failed']);
