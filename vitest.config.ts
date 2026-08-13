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
  },
});
