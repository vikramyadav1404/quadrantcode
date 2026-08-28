import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FlatCompat } from '@eslint/eslintrc';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

const __dirname = dirname(fileURLToPath(import.meta.url));
const compat = new FlatCompat({ baseDirectory: __dirname });

/**
 * F0.1 requirement 2 — the server-only boundary.
 *
 * `server/**` holds database access, secrets and business logic. Two mechanisms
 * keep it out of client bundles:
 *   1. `import 'server-only'` in server entrypoints, which fails the Next build
 *      when a Client Component pulls one in.
 *   2. The `no-restricted-imports` rule below, which fails lint (and therefore
 *      the pre-commit hook and CI) with a message explaining the fix.
 * Lint catches it earlier and explains it better; the build catches it even if
 * someone disables the rule.
 */
const SERVER_BOUNDARY = {
  patterns: [
    {
      group: ['@/server/*', '@/server/**', '**/server/db/**', '**/server/services/**'],
      message:
        'Client components must not import from server/. Fetch through a Server ' +
        'Component, a Server Action, or a route handler instead.',
    },
  ],
};

export default tseslint.config(
  {
    ignores: [
      '.next/**',
      'node_modules/**',
      'dist/**',
      'coverage/**',
      'next-env.d.ts',
      'server/db/migrations/**',
      '.playwright/**',
    ],
  },

  ...compat.extends('next/core-web-vitals'),
  ...tseslint.configs.recommended,

  {
    rules: {
      // Business rule: `any` needs a written justification, so it must be
      // deliberate. The rule stays an error; the escape hatch is an inline
      // disable with a one-line reason, which is greppable in review.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'warn',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      // Errors are typed and structured — never swallowed.
      'no-empty': ['error', { allowEmptyCatch: false }],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },

  /**
   * DENY BY DEFAULT. The rule applies to every file, then is switched off for
   * the directories that are legitimately server-side.
   *
   * The previous version listed only components/, lib/ and app/, which meant a
   * client component anywhere else was silently unguarded — caught by
   * tests/boundary/server-boundary.test.ts.
   */
  {
    files: ['**/*.{ts,tsx}'],
    rules: { 'no-restricted-imports': ['error', SERVER_BOUNDARY] },
  },

  // Server-side code, exempted by PATH rather than by an ad hoc disable.
  {
    files: [
      'server/**/*.ts',
      'worker/**/*.ts',
      'jobs/**/*.ts',
      'scripts/**/*.ts',
      'tests/**/*.{ts,tsx}',
      'e2e/**/*.ts',
      'playwright.config.ts',
      'app/**/page.tsx',
      'app/**/layout.tsx',
      'app/**/route.ts',
      'app/**/actions.ts',
      'app/**/opengraph-image.tsx',
      'middleware.ts',
      'drizzle.config.ts',
      'next.config.ts',
      'vitest.config.ts',
    ],
    rules: { 'no-restricted-imports': 'off' },
  },

  // The worker, jobs and scripts are plain Node — browser globals are absent
  // and console output is how they report.
  //
  // `server/lib/observability/logger.ts` is the exemption that matters: on
  // Vercel stdout IS the log pipeline, so the sanctioned logger has to call
  // `console.log` to do its job. Exempting the one file rather than
  // disabling the line keeps the rule's meaning intact — every OTHER console
  // call is still ad-hoc logging that bypasses redaction, which is exactly
  // what F4.6 exists to stop.
  {
    files: [
      'worker/**/*.ts',
      'jobs/**/*.ts',
      'scripts/**/*.ts',
      'server/db/migrate.ts',
      'server/db/rollback.ts',
      'server/lib/observability/logger.ts',
    ],
    rules: { 'no-console': 'off' },
  },

  {
    files: ['tests/**/*.ts', 'tests/**/*.tsx', 'e2e/**/*.ts', '**/*.test.ts', '**/*.test.tsx'],
    rules: { '@typescript-eslint/no-explicit-any': 'off', 'no-console': 'off' },
  },

  prettier,
);
