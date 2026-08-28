/**
 * F1.5 · the storage rule, checked against a real database.
 *
 * The ticket's non-negotiable is a schema claim, not a feature claim:
 *
 * > "Store it as enum columns and normalised child rows … One big text blob or
 * >  one big JSONB dump is a failed implementation — I will check the schema."
 *
 * So this suite checks the schema. The first two tests are the acceptance
 * criterion stated two ways — a taxonomy value can be filtered with a plain
 * `WHERE`, and no taxonomy value is hiding in JSONB — and the second is the one
 * that would still fail if someone "helpfully" moved the categories into
 * `extras` later.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MISTAKE_CATEGORIES, STUCK_CATEGORIES } from '@/lib/reflection/taxonomy';
import {
  problems,
  reflectionMistakes,
  reflections,
  solveSessions,
  stuckPoints,
} from '@/server/db/schema';
import {
  type TestContext,
  createUser,
  expectDbRejection,
  hasTestDatabase,
  setupTestDb,
  truncateAll,
} from '../helpers/db';

const suite = hasTestDatabase ? describe : describe.skip;

suite('F1.5 · reflection storage', () => {
  let ctx: TestContext;
  let userId: string;
  let sessionId: string;

  beforeAll(async () => {
    ctx = await setupTestDb();
  }, 60_000);

  afterAll(async () => {
    await ctx?.close();
  });

  beforeEach(async () => {
    await truncateAll(ctx.sql);
    userId = (await createUser(ctx.db, { email: 'reflection-schema@example.com' })).id;

    const [problem] = await ctx.db
      .insert(problems)
      .values({
        slug: 'two-sum',
        title: 'Two Sum',
        sourceType: 'external_link',
        platform: 'leetcode',
        externalUrl: 'https://leetcode.com/problems/two-sum/',
        difficulty: 'easy',
      })
      .returning();

    const [session] = await ctx.db
      .insert(solveSessions)
      .values({
        userId,
        problemId: problem!.id,
        status: 'solved',
        startedAt: new Date('2026-03-02T10:00:00.000Z'),
        lastHeartbeatAt: new Date('2026-03-02T10:30:00.000Z'),
        endedAt: new Date('2026-03-02T10:30:00.000Z'),
        startedLocalDate: '2026-03-02',
        endedLocalDate: '2026-03-02',
      })
      .returning();
    sessionId = session!.id;
  });

  describe('the acceptance criterion, both ways round', () => {
    it('FILTERS MISTAKES WITH A PLAIN WHERE CLAUSE — no JSON extraction', async () => {
      const [reflection] = await ctx.db
        .insert(reflections)
        .values({ sessionId, approach: 'Sorted, then two pointers.' })
        .returning();

      await ctx.db.insert(reflectionMistakes).values([
        { reflectionId: reflection!.id, category: 'off_by_one' },
        { reflectionId: reflection!.id, category: 'missed_edge_case' },
      ]);

      // Raw SQL on purpose: this is the criterion's own sentence executed. If
      // the categories lived in JSONB, this query could not be written.
      const rows = await ctx.sql`
        SELECT category FROM reflection_mistakes WHERE category = 'off_by_one'
      `;

      expect(rows).toHaveLength(1);
      expect(String(rows[0]!.category)).toBe('off_by_one');
    });

    it('KEEPS EVERY TAXONOMY FIELD OUT OF JSONB', async () => {
      /*
       * The guard that outlives this ticket. Anyone who later moves a category
       * into JSONB to "avoid a migration" fails here rather than in F3.5, six
       * months on, when a GROUP BY turns into a full scan.
       *
       * ## The allowlist, and why it grew by one
       *
       * F1.5 asserted "`extras` is the only JSONB column", which was a proxy for
       * the actual rule: **no taxonomy value may live in JSON**. F3.3 added
       * `stuck_points.evidence` — an array of sentences shown beside an inferred
       * region — and the proxy failed while the rule held.
       *
       * Evidence is prose. Nothing filters, groups or sorts by it; it is read
       * whole and rendered. So the allowlist names it explicitly rather than the
       * check being loosened to a count, and a NEW jsonb column still fails
       * until somebody writes down why it belongs.
       */
      const ALLOWED_JSONB = [
        { table: 'reflections', column: 'extras' },
        { table: 'stuck_points', column: 'evidence' },
      ];

      const jsonbColumns = await ctx.sql`
        SELECT table_name, column_name FROM information_schema.columns
        WHERE table_schema = 'public'
          AND data_type = 'jsonb'
          AND table_name IN ('reflections', 'reflection_mistakes',
                             'reflection_stuck_areas', 'stuck_points')
        ORDER BY table_name, column_name
      `;

      expect(
        jsonbColumns.map((row) => ({
          table: String(row['table_name']),
          column: String(row['column_name']),
        })),
      ).toEqual(ALLOWED_JSONB);
    });

    it('stores the taxonomies as real enums, not text', async () => {
      // The positive control for the test above: proving JSONB is absent means
      // nothing unless the values are somewhere better.
      const columns = await ctx.sql`
        SELECT table_name, column_name, udt_name FROM information_schema.columns
        WHERE table_schema = 'public' AND column_name = 'category'
          AND table_name IN ('reflection_mistakes', 'reflection_stuck_areas', 'stuck_points')
        ORDER BY table_name
      `;

      expect(columns.map((row) => String(row.udt_name))).toEqual([
        'mistake_category',
        'stuck_category',
        'stuck_category',
      ]);
    });

    it('the database rejects a category the taxonomy does not contain', async () => {
      const [reflection] = await ctx.db.insert(reflections).values({ sessionId }).returning();

      await expectDbRejection(
        ctx.sql`
          INSERT INTO reflection_mistakes (reflection_id, category)
          VALUES (${reflection!.id}, 'made_up_category')
        `,
        /invalid input value for enum/,
      );
    });

    it('the enum in the database matches the taxonomy in the code', async () => {
      /*
       * The two are generated from one array (`lib/reflection/taxonomy.ts`), and
       * this is what proves the generation actually happened rather than someone
       * having typed a matching list by hand.
       */
      const [mistake] = await ctx.sql`
        SELECT enum_range(NULL::mistake_category)::text AS values
      `;
      const [stuck] = await ctx.sql`
        SELECT enum_range(NULL::stuck_category)::text AS values
      `;

      const parse = (value: unknown) => String(value).replace(/[{}]/g, '').split(',');

      expect(parse(mistake!.values)).toEqual([...MISTAKE_CATEGORIES]);
      expect(parse(stuck!.values)).toEqual([...STUCK_CATEGORIES]);
    });
  });

  describe('one answer per question', () => {
    it('refuses the same mistake category twice on one reflection', async () => {
      // Ticking a box twice is one answer, and F3.5 counts these rows.
      const [reflection] = await ctx.db.insert(reflections).values({ sessionId }).returning();

      await ctx.db
        .insert(reflectionMistakes)
        .values({ reflectionId: reflection!.id, category: 'tle' });

      await expectDbRejection(
        ctx.db
          .insert(reflectionMistakes)
          .values({ reflectionId: reflection!.id, category: 'tle' }),
        'reflection_mistakes_unique',
      );
    });

    it('refuses a second reflection for the same session', async () => {
      // A re-submit edits the first rather than filing a competing account of
      // the same solve.
      await ctx.db.insert(reflections).values({ sessionId });

      await expectDbRejection(
        ctx.db.insert(reflections).values({ sessionId }),
        'reflections_session_key',
      );
    });
  });

  describe('stuck points', () => {
    it('allows many per session, and defaults to a user-made one', async () => {
      await ctx.db.insert(stuckPoints).values([
        { sessionId, category: 'approach', elapsedSeconds: 120 },
        { sessionId, category: 'implementation', elapsedSeconds: 600 },
        { sessionId, category: 'debugging', elapsedSeconds: 1200 },
      ]);

      const rows = await ctx.db.select().from(stuckPoints);
      expect(rows).toHaveLength(3);
      expect(rows.every((row) => row.source === 'user')).toBe(true);
    });

    it('separates user-marked from inferred in one query', async () => {
      // F3.3's criterion, made possible now rather than by a later backfill.
      await ctx.db.insert(stuckPoints).values([
        { sessionId, category: 'approach', elapsedSeconds: 60 },
        { sessionId, category: 'debugging', elapsedSeconds: 90, source: 'inferred' },
      ]);

      const rows = await ctx.sql`
        SELECT category FROM stuck_points WHERE source = 'user'
      `;
      expect(rows).toHaveLength(1);
      expect(String(rows[0]!.category)).toBe('approach');
    });

    it('rejects a negative elapsed time', async () => {
      await expectDbRejection(
        ctx.db
          .insert(stuckPoints)
          .values({ sessionId, category: 'approach', elapsedSeconds: -1 }),
        'stuck_points_elapsed_non_negative',
      );
    });

    it('caps a note so free text cannot become the storage', async () => {
      await expectDbRejection(
        ctx.db.insert(stuckPoints).values({
          sessionId,
          category: 'approach',
          elapsedSeconds: 60,
          note: 'x'.repeat(2001),
        }),
        'stuck_points_note_length',
      );
    });
  });

  it('deleting a session takes its reflection data with it', async () => {
    // The privacy path F3.2 has to honour ("delete my solve history") starts
    // here: the cascades must already be right.
    const [reflection] = await ctx.db.insert(reflections).values({ sessionId }).returning();
    await ctx.db
      .insert(reflectionMistakes)
      .values({ reflectionId: reflection!.id, category: 'wrong_logic' });
    await ctx.db
      .insert(stuckPoints)
      .values({ sessionId, category: 'approach', elapsedSeconds: 30 });

    await ctx.sql`DELETE FROM solve_sessions WHERE id = ${sessionId}`;

    expect(await ctx.db.select().from(reflections)).toHaveLength(0);
    expect(await ctx.db.select().from(reflectionMistakes)).toHaveLength(0);
    expect(await ctx.db.select().from(stuckPoints)).toHaveLength(0);
  });
});
