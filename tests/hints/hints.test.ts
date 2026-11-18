/**
 * AI hint coach: the prompt (what it carries and what it must not), and the
 * service against a real database with the model stubbed.
 */
import { readFile } from 'node:fs/promises';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { aiHints, problems } from '@/server/db/schema';
import {
  HINT_DAILY_LIMIT,
  HintError,
  buildHintPrompt,
  hintsSince,
  requestHint,
} from '@/server/services/hints';
import {
  importNativeProblemLibrary,
  loadNativeProblemBatches,
} from '@/server/services/native-content';
import {
  type TestContext,
  createUser,
  hasTestDatabase,
  setupTestDb,
  truncateAll,
} from '../helpers/db';

describe('buildHintPrompt (pure)', () => {
  const prompt = buildHintPrompt({
    title: 'Two Lanes',
    statement: 'Count the lanes.',
    language: 'python3',
    code: 'def solve():\n    pass',
    level: 2,
    previous: ['Look at the order of arrivals.'],
  });

  it('carries the statement, the code, the level and earlier hints', () => {
    expect(prompt).toContain('Two Lanes');
    expect(prompt).toContain('Count the lanes.');
    expect(prompt).toContain('def solve()');
    expect(prompt).toContain('Level 2');
    expect(prompt).toContain('Look at the order of arrivals.');
  });

  it('forbids a full solution', () => {
    expect(prompt).toMatch(/Never give the full solution/);
  });

  it('caps the code it sends', () => {
    const long = buildHintPrompt({
      title: 't',
      statement: 's',
      language: 'cpp17',
      code: 'x'.repeat(50_000),
      level: 1,
      previous: [],
    });
    expect(long.length).toBeLessThan(10_000);
  });
});

const suite = hasTestDatabase ? describe : describe.skip;
const companiesSchema = z.array(
  z.object({ slug: z.string(), name: z.string(), overview: z.string() }),
);

suite('requestHint', () => {
  let ctx: TestContext;
  let userId: string;
  let originalId: string;
  let externalId: string;
  const now = new Date('2026-11-18T12:00:00Z');
  let calls: string[] = [];

  const model: typeof fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body)) as {
      contents: { parts: { text: string }[] }[];
    };
    calls.push(body.contents[0]!.parts[0]!.text);
    return new Response(
      JSON.stringify({
        candidates: [{ content: { parts: [{ text: `hint ${calls.length}` }] } }],
      }),
      { status: 200 },
    );
  };

  beforeAll(async () => {
    ctx = await setupTestDb();
  }, 60_000);
  afterAll(async () => ctx?.close());

  beforeEach(async () => {
    await truncateAll(ctx.sql);
    calls = [];
    userId = (await createUser(ctx.db, { email: 'hints@example.com' })).id;
    const [batches, companies] = await Promise.all([
      loadNativeProblemBatches(),
      readFile('data/companies.json', 'utf8').then((source) =>
        companiesSchema.parse(JSON.parse(source)),
      ),
    ]);
    await importNativeProblemLibrary(ctx.db, batches.slice(0, 1), companies);
    const [first] = await ctx.db
      .select({ id: problems.id })
      .from(problems)
      .where(eq(problems.sourceType, 'original'))
      .limit(1);
    originalId = first!.id;
    await ctx.sql`UPDATE problems SET status = 'published' WHERE id = ${originalId}`;
    await ctx.sql`UPDATE problem_versions SET status = 'published', published_at = now() WHERE problem_id = ${originalId}`;
    const [external] = await ctx.db
      .insert(problems)
      .values({
        slug: 'external-one',
        title: 'External one',
        sourceType: 'external_link',
        platform: 'leetcode',
        externalUrl: 'https://leetcode.com/problems/external-one/',
        difficulty: 'easy',
        status: 'published',
      })
      .returning();
    externalId = external!.id;
  }, 60_000);

  const ask = (problemId: string, at = now) =>
    requestHint(ctx.db, {
      userId,
      problemId,
      language: 'python3',
      code: 'print(1)',
      now: at,
      apiKey: 'test-key',
      fetchImpl: model,
    });

  it('gives levels 1, 2, 3 and then stops for the day', async () => {
    expect((await ask(originalId)).level).toBe(1);
    expect((await ask(originalId)).level).toBe(2);
    const third = await ask(originalId);
    expect(third.level).toBe(3);
    expect(third.remainingToday).toBe(HINT_DAILY_LIMIT - 3);
    await expect(ask(originalId)).rejects.toBeInstanceOf(HintError);
    expect(calls).toHaveLength(3);
    expect(calls[2]).toContain('hint 1');
    expect(await ctx.db.select().from(aiHints)).toHaveLength(3);
  });

  it('starts again the next day', async () => {
    await ask(originalId);
    const tomorrow = new Date(now.getTime() + 24 * 60 * 60_000);
    expect((await ask(originalId, tomorrow)).level).toBe(1);
  });

  it('refuses external problems without calling the model', async () => {
    await expect(ask(externalId)).rejects.toThrow(/only on Quadrantcode problems/);
    expect(calls).toHaveLength(0);
  });

  it('never sends hidden tests or a reference solution', async () => {
    await ask(originalId);
    expect(calls[0]).not.toMatch(/reference|hidden|wrapper/i);
  });

  it('counts hints for the solve signal', async () => {
    await ask(originalId);
    await ask(originalId);
    expect(
      await hintsSince(ctx.db, { userId, problemId: originalId, since: new Date(0) }),
    ).toBe(2);
    expect(
      await hintsSince(ctx.db, {
        userId,
        problemId: originalId,
        since: new Date(Date.now() + 60_000),
      }),
    ).toBe(0);
  });
});
