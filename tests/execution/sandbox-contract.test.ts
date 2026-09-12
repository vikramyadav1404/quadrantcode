import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  sandboxCommandResultSchema,
  sandboxToolchainSchema,
} from '@/server/services/execution';

describe('trusted Sandbox protocol', () => {
  it('rejects unknown fields and invalid measurements', () => {
    const valid = {
      version: 1,
      status: 'exited',
      exitCode: 0,
      signal: null,
      cpuMs: 1,
      wallMs: 2,
      memoryKb: 3,
      outputTruncated: false,
    } as const;
    expect(sandboxCommandResultSchema.parse(valid)).toEqual(valid);
    expect(() => sandboxCommandResultSchema.parse({ ...valid, hiddenInput: 'nope' })).toThrow();
    expect(() => sandboxCommandResultSchema.parse({ ...valid, cpuMs: -1 })).toThrow();
  });

  it('requires an exact version string for every supported runtime', () => {
    expect(() =>
      sandboxToolchainSchema.parse({ c11: 'gcc', cpp17: 'g++', java: 'java' }),
    ).toThrow();
  });

  it('does not install packages on the submission execution path', () => {
    const source = readFileSync('server/services/execution/sandbox.ts', 'utf8');
    expect(source).not.toMatch(/runCommand\([^)]*(?:apt|npm|pip|curl)/s);
  });
});
