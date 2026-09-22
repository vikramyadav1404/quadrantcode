/**
 * Rollback runner.
 *
 * drizzle-kit generates up-migrations only. Every migration in this repo has a
 * hand-written counterpart in `server/db/migrations/down/` named
 * `<same-prefix>.down.sql`, and this script applies them newest-first inside a
 * single transaction, removing the corresponding row from drizzle's journal
 * table so a subsequent `db:migrate` re-applies cleanly.
 *
 *   npm run db:rollback        # roll back the most recent migration
 *   npm run db:rollback -- all # roll back everything
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import 'dotenv/config';
import postgres from 'postgres';
import { requireDirectDatabaseUrl } from './direct-url';

const DOWN_DIR = 'server/db/migrations/down';

export function downFiles(): string[] {
  return readdirSync(DOWN_DIR)
    .filter((name) => name.endsWith('.down.sql'))
    .sort()
    .reverse();
}

async function main(): Promise<void> {
  const url = requireDirectDatabaseUrl(process.env, 'roll a migration back');

  const all = process.argv.includes('all');
  const files = downFiles();
  const selected = all ? files : files.slice(0, 1);

  if (selected.length === 0) {
    console.log('nothing to roll back');
    return;
  }

  const client = postgres(url, { max: 1 });
  try {
    for (const file of selected) {
      const sqlText = readFileSync(join(DOWN_DIR, file), 'utf8');
      const tag = file.replace('.down.sql', '');

      await client.begin(async (tx) => {
        await tx.unsafe(sqlText);
        // Drop the journal row so `db:migrate` re-applies this migration.
        await tx`
          DELETE FROM drizzle.__drizzle_migrations
          WHERE hash IN (
            SELECT hash FROM drizzle.__drizzle_migrations ORDER BY created_at DESC LIMIT 1
          )
        `.catch(() => {
          // Journal table absent (fresh database) — nothing to clean up.
        });
      });

      console.log(`rolled back ${tag}`);
    }
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  console.error('rollback failed:', error);
  process.exit(1);
});
