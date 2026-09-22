/**
 * Which database URL the migration and seed tooling picks.
 *
 * Six consumers needed this and two orderings existed: `drizzle.config.ts` and
 * `migrate.ts` preferred `DIRECT_DATABASE_URL`, while `seed.ts`,
 * `seed-companies.ts`, `import-native-problems.ts` and `rollback.ts` went
 * straight to `DATABASE_URL_UNPOOLED`.
 *
 * That split had a live consequence. Vercel's `DATABASE_URL_UNPOOLED` is one
 * entry targeting Production AND Preview, so it cannot hold a per-environment
 * value; Preview was given a `DIRECT_DATABASE_URL` that shadows it. Any tool
 * skipping `DIRECT_DATABASE_URL` reached past the preview database to the
 * production one — a seed or rollback aimed at the wrong database, silently.
 *
 * The precedence test that matters is therefore the SECOND one: not "it finds
 * a URL", but "it prefers DIRECT_DATABASE_URL when both are set".
 */
import { describe, expect, it } from 'vitest';
import {
  DIRECT_URL_VARS,
  requireDirectDatabaseUrl,
  resolveDirectDatabaseUrl,
} from '@/server/db/direct-url';

const DIRECT = 'postgresql://u:p@ep-preview.example.neon.tech/db';
const UNPOOLED = 'postgresql://u:p@ep-production.example.neon.tech/db';
const POOLED = 'postgresql://u:p@ep-production-pooler.example.neon.tech/db';

describe('resolveDirectDatabaseUrl · precedence', () => {
  it('prefers DIRECT_DATABASE_URL over the Neon-set unpooled variable', () => {
    // The whole point. If this inverts, preview tooling hits production.
    expect(
      resolveDirectDatabaseUrl({
        DIRECT_DATABASE_URL: DIRECT,
        DATABASE_URL_UNPOOLED: UNPOOLED,
        DATABASE_URL: POOLED,
      }),
    ).toBe(DIRECT);
  });

  it('falls back to DATABASE_URL_UNPOOLED when no direct URL is set', () => {
    expect(
      resolveDirectDatabaseUrl({ DATABASE_URL_UNPOOLED: UNPOOLED, DATABASE_URL: POOLED }),
    ).toBe(UNPOOLED);
  });

  it('falls back to the pooled DATABASE_URL last', () => {
    expect(resolveDirectDatabaseUrl({ DATABASE_URL: POOLED })).toBe(POOLED);
  });

  it('returns undefined when nothing is set', () => {
    expect(resolveDirectDatabaseUrl({})).toBeUndefined();
  });

  it('treats an empty or whitespace value as unset', () => {
    // A var exported as '' is the usual way a shell "sets" nothing, and it must
    // not win over a real value further down the list.
    expect(
      resolveDirectDatabaseUrl({ DIRECT_DATABASE_URL: '', DATABASE_URL_UNPOOLED: UNPOOLED }),
    ).toBe(UNPOOLED);
    expect(
      resolveDirectDatabaseUrl({ DIRECT_DATABASE_URL: '   ', DATABASE_URL_UNPOOLED: UNPOOLED }),
    ).toBe(UNPOOLED);
  });

  it('trims a value rather than passing whitespace to the driver', () => {
    expect(resolveDirectDatabaseUrl({ DIRECT_DATABASE_URL: `  ${DIRECT}\n` })).toBe(DIRECT);
  });

  it('the declared order is the order that is applied', () => {
    // Guards against the list and the loop drifting apart.
    expect([...DIRECT_URL_VARS]).toEqual([
      'DIRECT_DATABASE_URL',
      'DATABASE_URL_UNPOOLED',
      'DATABASE_URL',
    ]);
    for (const [index, name] of DIRECT_URL_VARS.entries()) {
      const env = Object.fromEntries(DIRECT_URL_VARS.slice(index).map((key) => [key, key]));
      expect(resolveDirectDatabaseUrl(env)).toBe(name);
    }
  });
});

describe('requireDirectDatabaseUrl', () => {
  it('returns the resolved URL when one exists', () => {
    expect(requireDirectDatabaseUrl({ DIRECT_DATABASE_URL: DIRECT })).toBe(DIRECT);
  });

  it('names every variable it looked at, and the purpose, when none is set', () => {
    // The old messages named two of three variables, so the one that would have
    // fixed it was the one not mentioned.
    expect(() => requireDirectDatabaseUrl({}, 'run migrations')).toThrow(/run migrations/);
    for (const name of DIRECT_URL_VARS) {
      expect(() => requireDirectDatabaseUrl({}, 'run migrations')).toThrow(new RegExp(name));
    }
  });
});
