/**
 * Zod schemas for the problem catalog — ONE schema, TWO consumers.
 *
 * F1.1 requirement 4: the admin form and the server action validate the same
 * object. Two hand-kept-in-sync schemas drift, and the drift always favours
 * the client, which is the side an attacker controls.
 *
 * WHY THIS LIVES IN lib/ AND NOT server/services/problems/:
 * it must be importable by a Client Component, and the ESLint boundary rule
 * (correctly) forbids that from `server/**`. Zod schemas are isomorphic — no
 * database access, no secrets — so `lib/` is where the folder convention says
 * they go. The lint error that forced this move was the guard doing its job:
 * the alternative would have been an inline disable, which is how a boundary
 * quietly stops meaning anything.
 */
import { z } from 'zod';

export const DIFFICULTIES = ['easy', 'medium', 'hard'] as const;
export const PROBLEM_STATUSES = ['draft', 'review', 'tested', 'published', 'archived'] as const;
export const TAG_TYPES = ['topic', 'pattern', 'company_style'] as const;
export const USER_PROBLEM_STATUSES = [
  'not_started',
  'in_progress',
  'solved',
  'stuck',
  'needs_revision',
] as const;

/** Lowercase kebab-case. Matches the `problem_tags_value_normalised` CHECK. */
const tagValue = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Tags are lowercase kebab-case, e.g. "binary-search"');

export const slugSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Slug is lowercase kebab-case');

export const tagSchema = z.object({ tagType: z.enum(TAG_TYPES), tagValue }).refine(
  (tag) => tag.tagType !== 'company_style' || tag.tagValue.endsWith('-style'),
  // C3, mirrored from the `problem_tags_company_style_suffix` CHECK.
  { message: 'Company tags must end in "-style", e.g. "faang-style"', path: ['tagValue'] },
);

/** Fields that only an ORIGINAL problem may carry. C1 hinges on this list. */
export const STATEMENT_FIELDS = [
  'statement',
  'inputFormat',
  'outputFormat',
  'constraintsText',
  'examples',
  'editorial',
] as const;

export type StatementField = (typeof STATEMENT_FIELDS)[number];

const exampleSchema = z.object({
  input: z.string(),
  output: z.string(),
  explanation: z.string().optional(),
});

const baseProblemSchema = z.object({
  slug: slugSchema,
  title: z.string().min(3).max(200),
  difficulty: z.enum(DIFFICULTIES),
  estimatedMinutes: z.number().int().positive().max(600),
  isPremium: z.boolean().default(false),
  status: z.enum(PROBLEM_STATUSES).default('draft'),
  tags: z.array(tagSchema).max(24).default([]),
});

/**
 * External-link problem: a URL and no statement text, ever.
 *
 * The statement fields are typed as `never`-ish (optional + refined to absent)
 * rather than simply omitted, so a payload carrying them is REJECTED loudly
 * instead of being silently stripped. Silent stripping would let an admin
 * believe their statement was saved.
 */
export const externalProblemSchema = baseProblemSchema.extend({
  sourceType: z.literal('external_link'),
  platform: z.string().min(1).max(64),
  externalUrl: z.string().url().max(2048),

  statement: z.null().optional(),
  inputFormat: z.null().optional(),
  outputFormat: z.null().optional(),
  constraintsText: z.null().optional(),
  examples: z.null().optional(),
  editorial: z.null().optional(),
});

/** Original problem: our own text, no external URL. F4.1 extends this. */
export const originalProblemSchema = baseProblemSchema.extend({
  sourceType: z.literal('original'),
  platform: z.null().optional(),
  externalUrl: z.null().optional(),

  statement: z.string().min(1).optional(),
  inputFormat: z.string().optional(),
  outputFormat: z.string().optional(),
  constraintsText: z.string().optional(),
  examples: z.array(exampleSchema).optional(),
  editorial: z.string().optional(),
});

export const createProblemSchema = z.discriminatedUnion('sourceType', [
  externalProblemSchema,
  originalProblemSchema,
]);

export type CreateProblemInput = z.infer<typeof createProblemSchema>;

export const updateProblemSchema = z.object({
  id: z.string().uuid(),
  title: z.string().min(3).max(200).optional(),
  difficulty: z.enum(DIFFICULTIES).optional(),
  estimatedMinutes: z.number().int().positive().max(600).optional(),
  isPremium: z.boolean().optional(),
  status: z.enum(PROBLEM_STATUSES).optional(),
  platform: z.string().min(1).max(64).nullable().optional(),
  externalUrl: z.string().url().max(2048).nullable().optional(),
  tags: z.array(tagSchema).max(24).optional(),

  // Present so an attempt to set them on an external-link problem reaches the
  // service and is rejected with a ContentPolicyError, rather than being
  // dropped by the parser and appearing to succeed.
  statement: z.string().nullable().optional(),
  inputFormat: z.string().nullable().optional(),
  outputFormat: z.string().nullable().optional(),
  constraintsText: z.string().nullable().optional(),
  examples: z.array(exampleSchema).nullable().optional(),
  editorial: z.string().nullable().optional(),
});

export type UpdateProblemInput = z.infer<typeof updateProblemSchema>;

/** List filters. Every one is server-applied; none are honoured client-side. */
export const listFiltersSchema = z.object({
  difficulty: z.enum(DIFFICULTIES).optional(),
  topic: tagValue.optional(),
  pattern: tagValue.optional(),
  platform: z.string().min(1).max(64).optional(),
  /** The signed-in user's own solve status. Ignored when anonymous. */
  userStatus: z.enum(USER_PROBLEM_STATUSES).optional(),
  search: z.string().trim().min(1).max(200).optional(),
  cursor: z.string().max(512).optional(),
  limit: z.number().int().min(1).max(100).default(25),
  /** Admin-only: include archived and unpublished rows. */
  includeHidden: z.boolean().default(false),
});

export type ListFilters = z.input<typeof listFiltersSchema>;
export type ParsedListFilters = z.infer<typeof listFiltersSchema>;

export const bulkTagSchema = z.object({
  problemIds: z.array(z.string().uuid()).min(1).max(500),
  add: z.array(tagSchema).max(24).default([]),
  remove: z.array(tagSchema).max(24).default([]),
});

export type BulkTagInput = z.infer<typeof bulkTagSchema>;
