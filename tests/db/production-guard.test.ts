/**
 * Issue #27 · the guard that keeps test, e2e and seed processes off production.
 *
 * The real production endpoint is never written here — the repo is public.
 * The hash path is exercised with an invented endpoint and its hash, and the
 * shipped constant is checked for shape only.
 */
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  PRODUCTION_ENDPOINT_SHA256,
  PRODUCTION_FLAG,
  ProductionDatabaseError,
  assertEnvNotProduction,
  assertNotProductionDatabase,
  assertNotProductionUnlessFlagged,
  endpointIdOf,
  isProductionHost,
} from '@/lib/db/production-guard';
import { LOCAL_TEST_DATABASE_URL, applyLocalTestDefaults } from '@/lib/db/local-test-db';

const FAKE_ID = 'ep-invented-endpoint-a1b2c3d4';
const FAKE_HASH = createHash('sha256').update(FAKE_ID).digest('hex');
const POOLED = `${FAKE_ID}-pooler.us-east-2.aws.neon.tech`;
const DIRECT = `${FAKE_ID}.us-east-2.aws.neon.tech`;

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('#27 · endpointIdOf', () => {
  it('reduces the pooled and the direct host to the same endpoint', () => {
    expect(endpointIdOf(POOLED)).toBe(FAKE_ID);
    expect(endpointIdOf(DIRECT)).toBe(FAKE_ID);
  });

  it('is case-insensitive', () => {
    expect(endpointIdOf(DIRECT.toUpperCase())).toBe(FAKE_ID);
  });
});

describe('#27 · isProductionHost', () => {
  it('MATCHES BY HASH, for the pooled and the direct host alike', () => {
    expect(isProductionHost(POOLED, '', [FAKE_HASH])).toBe(true);
    expect(isProductionHost(DIRECT, '', [FAKE_HASH])).toBe(true);
  });

  it('POSITIVE CONTROL · a different endpoint on the same provider does not match', () => {
    expect(
      isProductionHost('ep-someone-else-9z9z.us-east-2.aws.neon.tech', '', [FAKE_HASH]),
    ).toBe(false);
  });

  it('never matches the local test database', () => {
    expect(isProductionHost('localhost')).toBe(false);
    expect(isProductionHost('127.0.0.1')).toBe(false);
  });

  it('also matches hosts named in PRODUCTION_DB_HOST, comma-separated', () => {
    expect(isProductionHost(POOLED, `other.example.com, ${DIRECT}`, [])).toBe(true);
    expect(isProductionHost('db.example.com', `other.example.com, ${DIRECT}`, [])).toBe(false);
  });

  it('ships a real SHA-256, not a placeholder', () => {
    expect(PRODUCTION_ENDPOINT_SHA256).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('#27 · assertNotProductionDatabase', () => {
  it('REFUSES the production database, and the message names the variable, not the host', () => {
    vi.stubEnv('PRODUCTION_DB_HOST', DIRECT);
    const url = `postgresql://user:secret-password@${POOLED}/neondb?sslmode=require`;

    let error: unknown;
    try {
      assertNotProductionDatabase(url, 'TEST_DATABASE_URL (vitest)');
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(ProductionDatabaseError);
    const message = (error as Error).message;
    expect(message).toContain('TEST_DATABASE_URL (vitest)');
    expect(message).toContain('PRODUCTION');
    // Nothing that identifies the database, and no credential, is ever printed.
    expect(message).not.toContain(FAKE_ID);
    expect(message).not.toContain('neon.tech');
    expect(message).not.toContain('secret-password');
  });

  it('lets the local test database through', () => {
    vi.stubEnv('PRODUCTION_DB_HOST', DIRECT);
    expect(() =>
      assertNotProductionDatabase(
        'postgresql://postgres:postgres@localhost:55432/quadrantcode_test',
        'TEST_DATABASE_URL',
      ),
    ).not.toThrow();
  });

  it('passes an unset URL — there is nothing to connect to', () => {
    expect(() => assertNotProductionDatabase(undefined, 'TEST_DATABASE_URL')).not.toThrow();
    expect(() => assertNotProductionDatabase('', 'TEST_DATABASE_URL')).not.toThrow();
  });

  it('REFUSES an unparseable URL, without echoing it', () => {
    const garbage = 'not a url with a password hunter2';
    expect(() => assertNotProductionDatabase(garbage, 'DATABASE_URL')).toThrowError(
      ProductionDatabaseError,
    );
    try {
      assertNotProductionDatabase(garbage, 'DATABASE_URL');
    } catch (error) {
      expect((error as Error).message).not.toContain('hunter2');
    }
  });
});

describe('#27 · assertNotProductionUnlessFlagged (content loaders)', () => {
  const prodUrl = `postgresql://user:pw@${DIRECT}/neondb`;

  it('REFUSES production without the flag, and says how to mean it', () => {
    vi.stubEnv('PRODUCTION_DB_HOST', DIRECT);
    expect(() =>
      assertNotProductionUnlessFlagged(prodUrl, 'DIRECT_DATABASE_URL (seed)', [
        'node',
        'scripts/seed.ts',
      ]),
    ).toThrowError(/--production/);
  });

  it('allows production only when --production is on this command line', () => {
    vi.stubEnv('PRODUCTION_DB_HOST', DIRECT);
    expect(() =>
      assertNotProductionUnlessFlagged(prodUrl, 'DIRECT_DATABASE_URL (seed)', [
        'node',
        'scripts/seed.ts',
        PRODUCTION_FLAG,
      ]),
    ).not.toThrow();
  });

  it('an environment variable named like the flag does not count', () => {
    vi.stubEnv('PRODUCTION_DB_HOST', DIRECT);
    vi.stubEnv('PRODUCTION', '1');
    expect(() =>
      assertNotProductionUnlessFlagged(prodUrl, 'DIRECT_DATABASE_URL (seed)', ['node', 'x']),
    ).toThrowError(ProductionDatabaseError);
  });
});

describe('#27 · local test defaults', () => {
  it('outside CI, an unset TEST_DATABASE_URL becomes the local embedded Postgres', () => {
    const env: Record<string, string | undefined> = {};
    applyLocalTestDefaults(env);
    expect(env['TEST_DATABASE_URL']).toBe(LOCAL_TEST_DATABASE_URL);
    expect(new URL(LOCAL_TEST_DATABASE_URL).hostname).toBe('localhost');
  });

  it('never overrides a value that is already set', () => {
    const env: Record<string, string | undefined> = {
      TEST_DATABASE_URL: 'postgresql://x@h/db',
    };
    applyLocalTestDefaults(env);
    expect(env['TEST_DATABASE_URL']).toBe('postgresql://x@h/db');
  });

  it('IN CI, leaves it unset, so a missing job variable fails loudly instead', () => {
    const env: Record<string, string | undefined> = { CI: 'true' };
    applyLocalTestDefaults(env);
    expect(env['TEST_DATABASE_URL']).toBeUndefined();
  });

  it('the default itself passes the guard', () => {
    expect(() => assertNotProductionDatabase(LOCAL_TEST_DATABASE_URL, 'default')).not.toThrow();
  });
});

describe('#27 · assertEnvNotProduction', () => {
  it('checks every listed variable, so DATABASE_URL cannot slip past a clean TEST_DATABASE_URL', () => {
    vi.stubEnv('PRODUCTION_DB_HOST', DIRECT);
    const env = {
      TEST_DATABASE_URL: 'postgresql://postgres:postgres@localhost:55432/quadrantcode_test',
      DATABASE_URL: `postgresql://user:pw@${POOLED}/neondb`,
    };

    expect(() =>
      assertEnvNotProduction(
        ['TEST_DATABASE_URL', 'DATABASE_URL'],
        'playwright.config.ts',
        env,
      ),
    ).toThrowError(/DATABASE_URL \(playwright\.config\.ts\)/);
  });

  it('POSITIVE CONTROL · the same call passes when every variable is local', () => {
    vi.stubEnv('PRODUCTION_DB_HOST', DIRECT);
    const local = 'postgresql://postgres:postgres@localhost:55432/quadrantcode_test';
    expect(() =>
      assertEnvNotProduction(['TEST_DATABASE_URL', 'DATABASE_URL'], 'playwright.config.ts', {
        TEST_DATABASE_URL: local,
        DATABASE_URL: local,
      }),
    ).not.toThrow();
  });
});
