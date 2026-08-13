import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    // Integration suites that need a real Postgres opt in via TEST_DATABASE_URL
    // and skip themselves when it is absent, so `npm test` stays green locally
    // and in CI without a database.
    globals: false,
    restoreMocks: true,

    /**
     * Test FILES run one at a time.
     *
     * The integration suites share a single database and each rebuilds the
     * public schema in `beforeAll`. Run in parallel they drop the schema out
     * from under each other, producing failures that have nothing to do with
     * the code under test. Serialising files is the honest fix; per-suite
     * schemas would be faster but would stop the migration test from
     * exercising the real `public` schema.
     */
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
});
