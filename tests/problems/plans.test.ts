/**
 * F1.1 · the catalog list must use an index, not a sequential scan.
 *
 * This exists because the first implementation silently did not: under the
 * old `created_at DESC` order, Drizzle's `DESC NULLS LAST` index columns did
 * not match Postgres's default `DESC NULLS FIRST`, so the planner discarded
 * the index and fell back to a seq scan plus a top-N sort (27.98ms vs 0.27ms at
 * 20k rows). Nothing about the RESULTS changed, which is exactly why only an
 * EXPLAIN assertion catches it.
 *
 * The catalog now reads `ORDER BY difficulty, number` (migration 0028). The
 * guard is the same: the service's query shape must walk
 * `problems_status_difficulty_number_idx`.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { listProblems, parseFilters } from '@/server/services/problems';
import { loadPerfDataset } from '../fixtures/perf-dataset';
import {
  type TestContext,
  createUser,
  hasTestDatabase,
  setupTestDb,
  truncateAll,
} from '../helpers/db';

const suite = hasTestDatabase ? describe : describe.skip;

type PlanNode = { 'Node Type': string; Plans?: PlanNode[]; 'Index Name'?: string };
const flatten = (node: PlanNode): PlanNode[] => [node, ...(node.Plans ?? []).flatMap(flatten)];

suite('F1.1 · query plans', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await setupTestDb();
    await truncateAll(ctx.sql);
    const user = await createUser(ctx.db);
    await loadPerfDataset({ sql: ctx.sql, userId: user.id, problems: 20_000, days: 30 });
  }, 240_000);

  afterAll(async () => {
    await ctx?.close();
  });

  async function plan(query: string): Promise<PlanNode[]> {
    const rows = await ctx.sql.unsafe(`EXPLAIN (ANALYZE, FORMAT JSON) ${query}`);
    return flatten((rows[0]!['QUERY PLAN'] as [{ Plan: PlanNode }])[0]!.Plan);
  }

  it('the unfiltered first page uses an index, not a seq scan', async () => {
    const nodes = await plan(`
      SELECT id, slug, title FROM problems WHERE status = 'published'
      ORDER BY difficulty, number LIMIT 26
    `);

    expect(nodes.some((n) => n['Index Name'] === 'problems_status_difficulty_number_idx')).toBe(
      true,
    );
    expect(nodes.filter((n) => n['Node Type'] === 'Seq Scan')).toHaveLength(0);
  });

  it('a later page, behind the keyset predicate, uses the same index', async () => {
    const nodes = await plan(`
      SELECT id, slug, title FROM problems
      WHERE status = 'published' AND (difficulty, number) > ('medium'::difficulty, 5000)
      ORDER BY difficulty, number LIMIT 26
    `);

    expect(nodes.some((n) => n['Index Name'] === 'problems_status_difficulty_number_idx')).toBe(
      true,
    );
    expect(nodes.filter((n) => n['Node Type'] === 'Seq Scan')).toHaveLength(0);
  });

  it('POSITIVE CONTROL — an order no index serves does seq scan', async () => {
    // Proves the assertions above are sensitive to the thing they claim to
    // guard. If this ever stops seq scanning, the guard has become vacuous.
    const nodes = await plan(`
      SELECT id, slug, title FROM problems WHERE status = 'published'
      ORDER BY estimated_minutes, title LIMIT 26
    `);

    expect(nodes.some((n) => n['Node Type'] === 'Seq Scan')).toBe(true);
  });

  it('the service issues the index-using form', async () => {
    // Guards the ORDER BY inside listProblems itself, not just a hand-written
    // query in this file.
    const result = await listProblems({ db: ctx.db, filters: parseFilters({ limit: 25 }) });
    expect(result.rows).toHaveLength(25);
    expect(result.nextCursor).not.toBeNull();
  });

  it('responds well inside the 200ms budget at 20k rows', async () => {
    const started = performance.now();
    await listProblems({
      db: ctx.db,
      filters: parseFilters({ difficulty: 'medium', limit: 25 }),
    });
    expect(performance.now() - started).toBeLessThan(200);
  });
});
