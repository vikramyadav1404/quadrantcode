/**
 * Catalog writes — create, update, archive, bulk tag.
 *
 * THE POLICY GATE (F1.1): every write passes through `assertContentPolicy`
 * before it reaches the database. That check duplicates the F0.2 CHECK
 * constraint on purpose — see `errors.ts` for why both exist.
 */
import { and, eq, inArray } from 'drizzle-orm';
import type { Database } from '@/server/db';
import { problemTags, problems } from '@/server/db/schema';
import { normaliseProblemUrl } from '@/server/services/ingest/normalise-url';
import {
  ContentPolicyError,
  type ContentPolicyViolation,
  DuplicateSlugError,
  ProblemNotFoundError,
} from './errors';
import {
  type BulkTagInput,
  type CreateProblemInput,
  STATEMENT_FIELDS,
  type UpdateProblemInput,
  bulkTagSchema,
  createProblemSchema,
  updateProblemSchema,
} from '@/lib/problems/schemas';

/**
 * C1 gate.
 *
 * Rejects any attempt to attach statement-bearing content to a problem that
 * lives on someone else's platform. `null` is fine — that is clearing a field;
 * anything else is a violation, including an empty array of examples, because
 * writing `examples: []` to an external problem means someone's form is
 * submitting a field it should not have.
 */
export function assertContentPolicy(
  sourceType: 'external_link' | 'original',
  payload: Record<string, unknown>,
): void {
  if (sourceType !== 'external_link') return;

  const violations: ContentPolicyViolation[] = [];

  for (const field of STATEMENT_FIELDS) {
    const value = payload[field];
    if (value !== undefined && value !== null) {
      violations.push({
        field,
        reason: 'external-link problems store metadata and a link only',
      });
    }
  }

  if (violations.length > 0) throw new ContentPolicyError(violations);
}

/** External-link problems must carry the URL that sends the user to the platform. */
function assertExternalUrlPresent(
  sourceType: 'external_link' | 'original',
  externalUrl: string | null | undefined,
): void {
  if (sourceType === 'external_link' && !externalUrl) {
    throw new ContentPolicyError([
      { field: 'externalUrl', reason: 'an external-link problem must link to its platform' },
    ]);
  }
}

/**
 * Reads `sourceType` off unvalidated input so the policy gate can run BEFORE
 * Zod. Order matters: `externalProblemSchema` types the statement fields as
 * null-only, so parsing first turns a policy violation into a generic
 * "expected null, received string" — technically a rejection, but useless to
 * the admin who needs to know *why* the field is forbidden.
 */
function peekSourceType(rawInput: unknown): 'external_link' | 'original' | null {
  if (typeof rawInput !== 'object' || rawInput === null) return null;
  const value = (rawInput as Record<string, unknown>).sourceType;
  return value === 'external_link' || value === 'original' ? value : null;
}

export async function createProblem(
  db: Database,
  rawInput: unknown,
): Promise<{ id: string; slug: string }> {
  // Policy first — see peekSourceType.
  const declaredSource = peekSourceType(rawInput);
  if (declaredSource) {
    assertContentPolicy(declaredSource, rawInput as Record<string, unknown>);
  }

  const input: CreateProblemInput = createProblemSchema.parse(rawInput);

  assertContentPolicy(input.sourceType, input as unknown as Record<string, unknown>);
  assertExternalUrlPresent(input.sourceType, input.externalUrl ?? null);

  const [existing] = await db
    .select({ id: problems.id })
    .from(problems)
    .where(eq(problems.slug, input.slug))
    .limit(1);
  if (existing) throw new DuplicateSlugError(input.slug);

  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(problems)
      .values({
        slug: input.slug,
        title: input.title,
        sourceType: input.sourceType,
        platform: input.platform ?? null,
        externalUrl: input.externalUrl ?? null,
        /*
         * F1.2 dedup key, derived here rather than by the database — see the
         * column comment in schema/problems.ts for why it is not GENERATED.
         * Deriving it on the write path is what makes the unique index able to
         * enforce "one URL is one catalog row"; a caller cannot supply it.
         */
        externalUrlNormalised: normaliseProblemUrl(input.externalUrl ?? null),
        difficulty: input.difficulty,
        estimatedMinutes: input.estimatedMinutes,
        isPremium: input.isPremium,
        status: input.status,
        statement: input.sourceType === 'original' ? (input.statement ?? null) : null,
        inputFormat: input.sourceType === 'original' ? (input.inputFormat ?? null) : null,
        outputFormat: input.sourceType === 'original' ? (input.outputFormat ?? null) : null,
        constraintsText:
          input.sourceType === 'original' ? (input.constraintsText ?? null) : null,
        examples: input.sourceType === 'original' ? (input.examples ?? null) : null,
        editorial: input.sourceType === 'original' ? (input.editorial ?? null) : null,
      })
      .returning({ id: problems.id, slug: problems.slug });

    if (!row) throw new Error('createProblem: insert returned no row');

    if (input.tags.length > 0) {
      await tx
        .insert(problemTags)
        .values(input.tags.map((tag) => ({ problemId: row.id, ...tag })))
        .onConflictDoNothing();
    }

    return row;
  });
}

export async function updateProblem(db: Database, rawInput: unknown): Promise<void> {
  const input: UpdateProblemInput = updateProblemSchema.parse(rawInput);

  const [current] = await db
    .select({
      id: problems.id,
      sourceType: problems.sourceType,
      externalUrl: problems.externalUrl,
    })
    .from(problems)
    .where(eq(problems.id, input.id))
    .limit(1);

  if (!current) throw new ProblemNotFoundError(input.id);

  // The policy is evaluated against the STORED source type, not a client-sent
  // one — otherwise the gate is bypassed by claiming the problem is original.
  assertContentPolicy(current.sourceType, input as unknown as Record<string, unknown>);

  const nextUrl = input.externalUrl === undefined ? current.externalUrl : input.externalUrl;
  assertExternalUrlPresent(current.sourceType, nextUrl);

  await db.transaction(async (tx) => {
    await tx
      .update(problems)
      .set({
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.difficulty !== undefined ? { difficulty: input.difficulty } : {}),
        ...(input.estimatedMinutes !== undefined
          ? { estimatedMinutes: input.estimatedMinutes }
          : {}),
        ...(input.isPremium !== undefined ? { isPremium: input.isPremium } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.platform !== undefined ? { platform: input.platform } : {}),
        /*
         * The dedup key moves with the URL, in the SAME conditional so the two
         * cannot be updated apart. Splitting them would let a URL change while
         * the key kept pointing at the old one — dedup would then match the
         * previous URL forever, which is a silent wrong answer rather than a
         * visible failure.
         */
        ...(input.externalUrl !== undefined
          ? {
              externalUrl: input.externalUrl,
              externalUrlNormalised: normaliseProblemUrl(input.externalUrl),
            }
          : {}),
        ...(current.sourceType === 'original'
          ? {
              ...(input.statement !== undefined ? { statement: input.statement } : {}),
              ...(input.inputFormat !== undefined ? { inputFormat: input.inputFormat } : {}),
              ...(input.outputFormat !== undefined ? { outputFormat: input.outputFormat } : {}),
              ...(input.constraintsText !== undefined
                ? { constraintsText: input.constraintsText }
                : {}),
              ...(input.examples !== undefined ? { examples: input.examples } : {}),
              ...(input.editorial !== undefined ? { editorial: input.editorial } : {}),
            }
          : {}),
      })
      .where(eq(problems.id, input.id));

    if (input.tags) {
      await tx.delete(problemTags).where(eq(problemTags.problemId, input.id));
      if (input.tags.length > 0) {
        await tx
          .insert(problemTags)
          .values(input.tags.map((tag) => ({ problemId: input.id, ...tag })))
          .onConflictDoNothing();
      }
    }
  });
}

/**
 * Archive — a visibility change, never a delete.
 *
 * `user_problems` rows are untouched: a user who solved this problem keeps
 * their history, their attempt counts and their best time, and the problem
 * stays reachable by direct slug for them.
 */
export async function archiveProblem(db: Database, id: string): Promise<void> {
  const [row] = await db
    .update(problems)
    .set({ status: 'archived' })
    .where(eq(problems.id, id))
    .returning({ id: problems.id });

  if (!row) throw new ProblemNotFoundError(id);
}

export async function unarchiveProblem(db: Database, id: string): Promise<void> {
  const [row] = await db
    .update(problems)
    .set({ status: 'published' })
    .where(eq(problems.id, id))
    .returning({ id: problems.id });

  if (!row) throw new ProblemNotFoundError(id);
}

/** Bulk tag management for admins. One transaction, so a partial apply is impossible. */
export async function bulkUpdateTags(db: Database, rawInput: unknown): Promise<void> {
  const input: BulkTagInput = bulkTagSchema.parse(rawInput);

  await db.transaction(async (tx) => {
    for (const tag of input.remove) {
      await tx
        .delete(problemTags)
        .where(
          and(
            inArray(problemTags.problemId, input.problemIds),
            eq(problemTags.tagType, tag.tagType),
            eq(problemTags.tagValue, tag.tagValue),
          ),
        );
    }

    if (input.add.length > 0) {
      const rows = input.problemIds.flatMap((problemId) =>
        input.add.map((tag) => ({ problemId, ...tag })),
      );
      await tx.insert(problemTags).values(rows).onConflictDoNothing();
    }
  });
}
