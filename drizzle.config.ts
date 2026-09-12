import 'dotenv/config';
import { defineConfig } from 'drizzle-kit';

const url =
  process.env.DIRECT_DATABASE_URL ??
  process.env.DATABASE_URL_UNPOOLED ??
  process.env.DATABASE_URL;

if (!url) {
  throw new Error(
    'DIRECT_DATABASE_URL, DATABASE_URL_UNPOOLED or DATABASE_URL must be set for drizzle-kit. See .env.example.',
  );
}

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
