/**
 * F1.1 · the content-policy gate (C1).
 *
 * The service layer rejects the write BEFORE it reaches the database, with a
 * message an admin can act on. The F0.2 CHECK remains the backstop; a test at
 * the bottom of this file proves the backstop still fires when the service is
 * bypassed entirely, because defence in depth is only real if both layers are
 * verified.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { problemTags, problems } from '@/server/db/schema';
import {
  ContentPolicyError,
  DuplicateSlugError,
  archiveProblem,
  assertContentPolicy,
  createProblem,
  updateProblem,
} from '@/server/services/problems';
import {
  type TestContext,
  expectDbRejection,
  hasTestDatabase,
  setupTestDb,
  truncateAll,
} from '../helpers/db';

const suite = hasTestDatabase ? describe : describe.skip;

const externalInput = {
  slug: 'two-sum',
  title: 'Two Sum',
  sourceType: 'external_link' as const,
  platform: 'leetcode',
  externalUrl: 'https://leetcode.com/problems/two-sum/',
  difficulty: 'easy' as const,
  estimatedMinutes: 15,
  status: 'published' as const,
  tags: [{ tagType: 'topic' as const, tagValue: 'arrays' }],
};

describe('F1.1 · assertContentPolicy (pure)', () => {
  it.each([
    'statement',
    'inputFormat',
    'outputFormat',
    'constraintsText',
    'examples',
    'editorial',
  ])('rejects %s on an external-link problem', (field) => {
    expect(() => assertContentPolicy('external_link', { [field]: 'anything' })).toThrow(
      ContentPolicyError,
    );
  });

  it('names every offending field in the error', () => {
    let error: ContentPolicyError | undefined;
    try {
      assertContentPolicy('external_link', { statement: 'x', editorial: 'y' });
    } catch (caught) {
      error = caught as ContentPolicyError;
    }

    expect(error?.violations.map((violation) => violation.field)).toEqual([
      'statement',
      'editorial',
    ]);
    // The message must explain the rule, not just state a failure.
    expect(error?.message).toMatch(/metadata and a link only/);
    expect(error?.message).toMatch(/create the problem as an original/);
    expect(error?.status).toBe(422);
  });

  it('permits null — clearing a field is not a violation', () => {
    expect(() => assertContentPolicy('external_link', { statement: null })).not.toThrow();
  });

  it('rejects an empty examples array, because the form should not send it', () => {
    expect(() => assertContentPolicy('external_link', { examples: [] })).toThrow(
      ContentPolicyError,
    );
  });

  it('leaves original problems alone', () => {
    expect(() =>
      assertContentPolicy('original', { statement: 'Our own text.', editorial: 'Ours too.' }),
    ).not.toThrow();
  });
});

suite('F1.1 · policy enforcement against the database', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await setupTestDb();
  }, 60_000);

  afterAll(async () => {
    await ctx?.close();
  });

  beforeEach(async () => {
    await truncateAll(ctx.sql);
  });

  it('creates a metadata-only external problem', async () => {
    const created = await createProblem(ctx.db, externalInput);

    const [row] = await ctx.db.select().from(problems).where(eq(problems.id, created.id));
    expect(row?.statement).toBeNull();
    expect(row?.externalUrl).toBe(externalInput.externalUrl);

    const tags = await ctx.db
      .select()
      .from(problemTags)
      .where(eq(problemTags.problemId, created.id));
    expect(tags).toHaveLength(1);
  });

  it('REJECTS a statement at create time, and writes nothing', async () => {
    await expect(
      createProblem(ctx.db, { ...externalInput, statement: 'Given an array...' }),
    ).rejects.toThrow(ContentPolicyError);

    // The rejection must happen before any row is written.
    expect(await ctx.db.select().from(problems)).toHaveLength(0);
  });

  it('REJECTS a statement at update time, judged on the STORED source type', async () => {
    const created = await createProblem(ctx.db, externalInput);

    await expect(
      updateProblem(ctx.db, { id: created.id, statement: 'Sneaking it in later' }),
    ).rejects.toThrow(ContentPolicyError);

    // Claiming the problem is original in the payload must not bypass the gate —
    // the service reads source_type from the database, not from the caller.
    await expect(
      updateProblem(ctx.db, {
        id: created.id,
        sourceType: 'original',
        statement: 'Claiming to be original',
      } as never),
    ).rejects.toThrow(ContentPolicyError);

    const [row] = await ctx.db.select().from(problems).where(eq(problems.id, created.id));
    expect(row?.statement).toBeNull();
  });

  it('requires an external URL on an external-link problem', async () => {
    await expect(
      createProblem(ctx.db, { ...externalInput, externalUrl: undefined } as never),
    ).rejects.toThrow();
  });

  it('allows an original problem to carry our own statement', async () => {
    const created = await createProblem(ctx.db, {
      slug: 'rolling-trade-volume',
      title: 'Rolling Trade Volume',
      sourceType: 'original',
      difficulty: 'medium',
      estimatedMinutes: 35,
      status: 'draft',
      statement: 'Our own original statement text.',
      tags: [{ tagType: 'pattern', tagValue: 'sliding-window' }],
    });

    const [row] = await ctx.db.select().from(problems).where(eq(problems.id, created.id));
    expect(row?.statement).toBe('Our own original statement text.');
    expect(row?.externalUrl).toBeNull();
  });

  it('rejects a duplicate slug with a typed error, not a raw constraint failure', async () => {
    await createProblem(ctx.db, externalInput);
    await expect(createProblem(ctx.db, externalInput)).rejects.toThrow(DuplicateSlugError);
  });

  it('rejects a bare company tag (C3) at the schema layer', async () => {
    await expect(
      createProblem(ctx.db, {
        ...externalInput,
        tags: [{ tagType: 'company_style', tagValue: 'google' }],
      }),
    ).rejects.toThrow(/-style/);
  });

  describe('the database backstop still fires when the service is bypassed', () => {
    it('rejects a raw insert carrying a statement', async () => {
      // This is the scenario the service cannot protect against: a migration,
      // a psql session, or a future code path that forgets the gate.
      await expectDbRejection(
        ctx.db.insert(problems).values({
          slug: 'bypass-attempt',
          title: 'Bypass Attempt',
          sourceType: 'external_link',
          platform: 'leetcode',
          externalUrl: 'https://leetcode.com/problems/bypass-attempt/',
          difficulty: 'easy',
          statement: 'Copied from the platform',
        }),
        'problems_external_link_no_statement',
      );
    });
  });

  describe('archiving preserves user history', () => {
    it('archives without touching user_problems', async () => {
      const created = await createProblem(ctx.db, externalInput);

      const [user] = await ctx.sql`
        INSERT INTO users (email) VALUES ('archiver@example.com') RETURNING id
      `;
      await ctx.sql`
        INSERT INTO user_problems (user_id, problem_id, status, total_attempts)
        VALUES (${user!.id}, ${created.id}, 'solved', 3)
      `;

      await archiveProblem(ctx.db, created.id);

      const [row] = await ctx.db.select().from(problems).where(eq(problems.id, created.id));
      expect(row?.status).toBe('archived');

      // The agreed semantics: archiving is a visibility change, never a delete.
      const history = await ctx.sql`
        SELECT status, total_attempts FROM user_problems WHERE problem_id = ${created.id}
      `;
      expect(history).toHaveLength(1);
      expect(history[0]!.status).toBe('solved');
      expect(Number(history[0]!.total_attempts)).toBe(3);
    });
  });
});
