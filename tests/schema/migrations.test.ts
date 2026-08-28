/**
 * F0.2 acceptance criterion: "Migration runs up and down cleanly."
 *
 * Runs the full up stack, the full down stack, and the up stack again against
 * a scratch schema — so a rollback that leaves an orphaned type, trigger or
 * function behind fails here rather than during an incident.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import { TEST_DATABASE_URL, applyMigrations, hasTestDatabase } from '../helpers/db';

const suite = hasTestDatabase ? describe : describe.skip;

const DOWN_DIR = 'server/db/migrations/down';
const UP_DIR = 'server/db/migrations';

/**
 * Every table the migrations should produce, listed explicitly.
 *
 * An exact-equality assertion rather than a subset check, which is the point:
 * adding a table without updating this list fails the build, so a table can
 * never appear in the schema without someone also writing its DOWN migration.
 * That is exactly what happened when F1.2 added the two below.
 */
const EXPECTED_TABLES = [
  'analytics_daily', // F1.6
  'analytics_stuck_daily', // F1.6
  'analytics_topic_daily', // F1.6
  'auth_accounts',
  'auth_sessions',
  'auth_verification_tokens',
  'code_snapshots', // F3.2
  'daily_goals',
  'daily_sessions',
  'execution_jobs', // F3.1
  'import_job_rows', // F1.2
  'import_jobs', // F1.2
  'mistake_patterns', // F3.5
  'mistake_warnings_shown', // F3.5
  'problem_tags',
  'problems',
  'reflection_mistakes', // F1.5
  'reflection_stuck_areas', // F1.5
  'reflections', // F1.5
  'revision_schedule', // F2.1
  'run_attempts', // F3.1
  'session_events', // F1.4
  'solve_sessions', // F1.4
  'streak_freezes', // F1.3
  'stuck_points', // F1.5
  'user_problems',
  'user_profiles',
  'user_streaks', // F1.3
  'users',
  'verification_methods',
];

suite('F0.2 · migrations run up and down cleanly', () => {
  let client: ReturnType<typeof postgres>;

  beforeAll(() => {
    client = postgres(TEST_DATABASE_URL!, { max: 1, onnotice: () => {} });
  });

  afterAll(async () => {
    await client?.end();
  });

  async function applyDownMigrations(): Promise<void> {
    const files = readdirSync(DOWN_DIR)
      .filter((name) => name.endsWith('.down.sql'))
      .sort()
      .reverse();

    for (const file of files) {
      await client.unsafe(readFileSync(join(DOWN_DIR, file), 'utf8'));
    }
  }

  async function tableNames(): Promise<string[]> {
    const rows = await client`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename
    `;
    return rows.map((row) => String(row.tablename));
  }

  it('every up migration has a matching down migration', () => {
    const ups = readdirSync(UP_DIR)
      .filter((name) => name.endsWith('.sql'))
      .map((name) => name.replace('.sql', ''))
      .sort();
    const downs = readdirSync(DOWN_DIR)
      .filter((name) => name.endsWith('.down.sql'))
      .map((name) => name.replace('.down.sql', ''))
      .sort();

    expect(downs).toEqual(ups);
  });

  it('applies up, rolls back to empty, and re-applies', async () => {
    await client.unsafe('DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;');

    await applyMigrations(client);
    expect(await tableNames()).toEqual(EXPECTED_TABLES);

    await applyDownMigrations();
    expect(await tableNames()).toEqual([]);

    // Nothing may survive the rollback — a leftover enum type would make the
    // re-apply fail with "type already exists".
    const leftoverTypes = await client`
      SELECT typname FROM pg_type t
      JOIN pg_namespace n ON n.oid = t.typnamespace
      WHERE n.nspname = 'public' AND t.typtype = 'e'
    `;
    expect(leftoverTypes).toHaveLength(0);

    const leftoverFunctions = await client`
      SELECT proname FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND proname LIKE 'traceloop%'
    `;
    expect(leftoverFunctions).toHaveLength(0);

    await applyMigrations(client);
    expect(await tableNames()).toEqual(EXPECTED_TABLES);
  }, 120_000);
});
