/**
 * Issue #32 · test, e2e and local-build processes stay off production's other
 * services (Upstash, Sentry), the way #27 keeps them off its database.
 *
 * The fix rests on one claim about Next: a variable already set in the
 * process, even to the empty string, is never overridden by `.env.local`.
 * That is checked against Next's own loader, in a fresh child process (as
 * `next start` is), with a control showing the same loader DOES fill the
 * variable when it is absent — so the check can fail.
 *
 * No real credential appears here: every value is invented.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  PRODUCTION_SERVICE_VARIABLES,
  ProductionServiceError,
  assertNoProductionServices,
  blankProductionServices,
  blankedProductionServices,
} from '@/lib/db/production-services';

const INVENTED: Record<(typeof PRODUCTION_SERVICE_VARIABLES)[number], string> = {
  UPSTASH_REDIS_REST_URL: 'https://invented-production.upstash.example',
  UPSTASH_REDIS_REST_TOKEN: 'invented-upstash-token-0000',
  SENTRY_DSN: 'https://0000invented@o0.ingest.sentry.example/0',
  NEXT_PUBLIC_SENTRY_DSN: 'https://1111invented@o0.ingest.sentry.example/1',
  SENTRY_AUTH_TOKEN: 'invented-sentry-auth-token-0000',
};

describe('#32 · the variables', () => {
  it('covers Upstash, server and browser Sentry, and the source-map token', () => {
    expect([...PRODUCTION_SERVICE_VARIABLES].sort()).toEqual(
      [
        'NEXT_PUBLIC_SENTRY_DSN',
        'SENTRY_AUTH_TOKEN',
        'SENTRY_DSN',
        'UPSTASH_REDIS_REST_TOKEN',
        'UPSTASH_REDIS_REST_URL',
      ].sort(),
    );
  });

  it('blanks each one to the empty string, not to undefined', () => {
    const env: Record<string, string | undefined> = { ...INVENTED, KEEP: 'kept' };
    blankProductionServices(env);
    for (const name of PRODUCTION_SERVICE_VARIABLES) expect(env[name]).toBe('');
    expect(env['KEEP']).toBe('kept');
    expect(blankedProductionServices()).toEqual(
      Object.fromEntries(PRODUCTION_SERVICE_VARIABLES.map((name) => [name, ''])),
    );
  });
});

describe('#32 · assertNoProductionServices', () => {
  it('passes when they are empty or unset', () => {
    expect(() => assertNoProductionServices(blankedProductionServices(), 'test')).not.toThrow();
    expect(() => assertNoProductionServices({}, 'test')).not.toThrow();
  });

  it('refuses any one of them with a value, naming it', () => {
    for (const name of PRODUCTION_SERVICE_VARIABLES) {
      const env = { ...blankedProductionServices(), [name]: INVENTED[name] };
      expect(() => assertNoProductionServices(env, 'a test process')).toThrow(
        ProductionServiceError,
      );
      expect(() => assertNoProductionServices(env, 'a test process')).toThrow(name);
    }
  });

  it('never prints a value, since the message can reach CI logs', () => {
    try {
      assertNoProductionServices(INVENTED, 'a test process');
      expect.unreachable('it should have thrown');
    } catch (error) {
      const message = (error as Error).message;
      for (const value of Object.values(INVENTED)) expect(message).not.toContain(value);
      expect(message).toContain('UPSTASH_REDIS_REST_URL');
      expect(message).toContain('a test process');
    }
  });
});

describe("#32 · Next's env loader keeps an empty value over .env.local", () => {
  let dir: string;
  const nextEnv = createRequire(import.meta.url).resolve('@next/env');

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'qc-32-'));
    writeFileSync(
      join(dir, '.env.local'),
      Object.entries(INVENTED)
        .map(([name, value]) => `${name}=${value}`)
        .join('\n'),
    );
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  /**
   * Loads `.env.local` from `dir` with Next's loader in a fresh Node process,
   * as `next start` and `next build` do, and returns what each variable ends as.
   */
  function loadInChild(env: NodeJS.ProcessEnv): Record<string, string | null> {
    const script =
      `const { loadEnvConfig } = require(${JSON.stringify(nextEnv)});` +
      `loadEnvConfig(${JSON.stringify(dir)}, false, { info() {}, error() {} });` +
      `const names = ${JSON.stringify(PRODUCTION_SERVICE_VARIABLES)};` +
      `process.stdout.write(JSON.stringify(Object.fromEntries(` +
      `names.map((n) => [n, n in process.env ? process.env[n] : null]))));`;
    const result = spawnSync(process.execPath, ['-e', script], { env, encoding: 'utf8' });
    expect(result.status, result.stderr).toBe(0);
    return JSON.parse(result.stdout) as Record<string, string | null>;
  }

  /** The parent's environment, minus these variables, as `next start` would run. */
  function baseEnv(): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = { ...process.env, NODE_ENV: 'production' };
    for (const name of PRODUCTION_SERVICE_VARIABLES) delete env[name];
    delete env['__NEXT_PROCESSED_ENV'];
    return env;
  }

  it('CONTROL: with the variables absent, .env.local fills every one', () => {
    // Without this, the test below could pass because the loader never read
    // the file at all.
    expect(loadInChild(baseEnv())).toEqual(INVENTED);
  });

  it('with the variables blanked, every one stays empty', () => {
    const loaded = loadInChild({ ...baseEnv(), ...blankedProductionServices() });
    for (const name of PRODUCTION_SERVICE_VARIABLES) expect(loaded[name]).toBe('');
  });
});

describe('#32 · where the blanking is applied', () => {
  it('vitest workers inherit it from vitest.config.ts', () => {
    for (const name of PRODUCTION_SERVICE_VARIABLES) expect(process.env[name]).toBe('');
    expect(() => assertNoProductionServices(process.env, 'a vitest worker')).not.toThrow();
  });

  it("the e2e server's environment in playwright.config.ts has every one empty", async () => {
    const { default: config } = await import('../../playwright.config');
    const servers = Array.isArray(config.webServer) ? config.webServer : [config.webServer];
    const app = servers.find((server) => server?.command?.includes('next start'));
    expect(app, 'the next start web server').toBeDefined();
    for (const name of PRODUCTION_SERVICE_VARIABLES) expect(app!.env?.[name]).toBe('');
  });
});
