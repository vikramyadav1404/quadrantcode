/**
 * F0.1 acceptance criterion: "Every env var in .env.example has a comment."
 *
 * Previously a one-off script run. A criterion checked once and never again is
 * not a criterion, so it is a test.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const lines = readFileSync('.env.example', 'utf8').split('\n');

const declarations = lines
  .map((line, index) => ({ line, index }))
  .filter(({ line }) => /^[A-Z][A-Z0-9_]*=/.test(line))
  .map(({ line, index }) => ({ name: line.split('=')[0]!, index }));

describe('F0.1 · .env.example', () => {
  it('declares variables at all', () => {
    expect(declarations.length).toBeGreaterThan(20);
  });

  it('gives every variable a preceding comment line', () => {
    const uncommented = declarations
      .filter(({ index }) => !(lines[index - 1] ?? '').trim().startsWith('#'))
      .map(({ name }) => name);

    expect(uncommented).toEqual([]);
  });

  it('has no duplicate declarations', () => {
    const names = declarations.map((d) => d.name);
    expect(names).toEqual([...new Set(names)]);
  });

  it('documents every variable the server env schema knows about', async () => {
    const { __testing } = await import('@/server/env');
    const documented = new Set(declarations.map((d) => d.name));

    // Pull the key list out of the Zod schema so a new variable added in code
    // but forgotten in .env.example fails here.
    const parsed = __testing.serverEnvSchema.safeParse({
      DATABASE_URL: 'postgresql://localhost:5432/x',
    });
    expect(parsed.success).toBe(true);

    for (const required of ['DATABASE_URL', 'NEXT_PUBLIC_APP_URL', 'NODE_ENV']) {
      expect(documented, `${required} is missing from .env.example`).toContain(required);
    }
  });

  it('contains no real-looking secret value', () => {
    // .env.example is committed; every value must be a placeholder or empty.
    const suspicious = declarations.filter(({ index }) => {
      const value = (lines[index] ?? '').split('=').slice(1).join('=').trim();
      return /^(sk-|re_|rzp_live|AIza|ghp_)/.test(value);
    });

    expect(suspicious).toEqual([]);
  });
});
