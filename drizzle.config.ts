import 'dotenv/config';
import { defineConfig } from 'drizzle-kit';
import { requireDirectDatabaseUrl } from './server/db/direct-url';

const url = requireDirectDatabaseUrl(process.env, 'run drizzle-kit');

export default defineConfig({
  dialect: 'postgresql',
  schema: './server/db/schema/index.ts',
  out: './server/db/migrations',
  casing: 'snake_case',
  dbCredentials: { url },
  // Versioned SQL files are reviewed and committed; never auto-pushed.
  strict: true,
  verbose: true,
});
