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

  /**
   * Every key the schema declares, including through intersections.
   *
   * `serverEnvSchema` is an intersection, so `.shape` is not on the top-level
   * node — the keys live on each side. Walking it is what makes the test below
   * actually enumerate rather than sample.
   */
  function collectSchemaKeys(node: unknown, out: Set<string>): void {
    const def = (node as { def?: Record<string, unknown> } | undefined)?.def;
    if (!def) return;

    if (def['shape']) for (const key of Object.keys(def['shape'] as object)) out.add(key);
    for (const side of ['left', 'right', 'in', 'out', 'innerType'] as const) {
      if (def[side]) collectSchemaKeys(def[side], out);
    }
  }

  it('documents EVERY variable the server env schema knows about', async () => {
    /*
     * This test used to check three hardcoded names while its comment claimed
     * to "pull the key list out of the Zod schema so a new variable added in
     * code but forgotten in .env.example fails here". It did not, and the
     * comment was the reason nobody looked: GITHUB_ID, GITHUB_SECRET and
     * ALLOW_IN_MEMORY_RATE_LIMIT were all in the schema and all undocumented,
     * and this file was green the whole time.
     *
     * Now it enumerates. A variable added to `server/env.ts` and forgotten here
     * fails, which is what the old comment promised.
     */
    const { __testing } = await import('@/server/env');
    const documented = new Set(declarations.map((d) => d.name));

    const schemaKeys = new Set<string>();
    collectSchemaKeys(__testing.serverEnvSchema, schemaKeys);

    // Proves the walker found the schema at all — an empty set would make the
    // assertion below pass vacuously, which is the bug this test just had.
    expect(schemaKeys.size).toBeGreaterThan(20);
    expect(schemaKeys).toContain('DATABASE_URL');

    const undocumented = [...schemaKeys].filter((key) => !documented.has(key)).sort();
    expect(undocumented, 'in server/env.ts but not in .env.example').toEqual([]);
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
