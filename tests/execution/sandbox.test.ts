import { describe, expect, it, vi } from 'vitest';
import {
  EXECUTION_LIMITS,
  ProviderUnavailableError,
  SANDBOX_COMMANDS,
  VercelSandboxProvider,
  truncateUtf8Output,
  type ExecutionSandbox,
  type SandboxFactory,
} from '@/server/services/execution';

const IMAGE = `quadrantcode-execution@sha256:${'a'.repeat(64)}`;
const META = JSON.stringify({
  version: 1,
  status: 'exited',
  exitCode: 0,
  signal: null,
  cpuMs: 2,
  wallMs: 3,
  memoryKb: 1024,
  outputTruncated: false,
});

function fakeSandbox() {
  const files = new Map<string, string>([
    [
      '/opt/quadrant/toolchain-runtime.json',
      JSON.stringify({
        c11: 'gcc 13.3.0',
        cpp17: 'g++ 13.3.0',
        java: 'openjdk 21',
        python3: 'Python 3.12',
        javascript: 'Node v22',
      }),
    ],
  ]);
  let run = 0;
  const stop = vi.fn(async () => undefined);
  const sandbox: ExecutionSandbox = {
    name: 'sandbox-safe-name',
    expiresAt: new Date('2026-09-08T10:01:00.000Z'),
    fs: {
      writeFile: async (path, data) => void files.set(path, data.toString()),
      readFile: async (path) => {
        const value = files.get(path);
        if (value === undefined) throw new Error('missing fixture file');
        return value;
      },
      mkdir: async () => undefined,
      rm: async () => undefined,
    },
    runCommand: async ({ args = [] }) => {
      if (
        args[0]?.startsWith('--prepare-') ||
        args[0]?.startsWith('--cleanup-') ||
        args[0] === '--seal-workspace'
      ) {
        return { exitCode: 0 };
      }
      const valueAfter = (flag: string) => args[args.indexOf(flag) + 1]!;
      files.set(valueAfter('--result'), META);
      files.set(valueAfter('--stdout'), run++ === 0 ? '' : '42\n');
      files.set(valueAfter('--stderr'), '');
      return { exitCode: 0 };
    },
    stop,
  };
  return { sandbox, stop };
}

describe('Vercel Sandbox provider', () => {
  it('creates one ephemeral deny-all sandbox with no environment or ports', async () => {
    const fixture = fakeSandbox();
    const factory = vi.fn<SandboxFactory>().mockResolvedValue(fixture.sandbox);
    const provider = new VercelSandboxProvider(IMAGE, factory);
    const heartbeat = vi.fn(async () => undefined);
    const sandboxCreated = vi.fn(async () => undefined);
    const cleanupFinished = vi.fn(async () => undefined);

    const result = await provider.executeSuite({
      language: 'python3',
      source: 'print(42)',
      cases: [{ ordinal: 1, stdin: '' }],
      lifecycle: { heartbeat, sandboxCreated, cleanupFinished },
    });

    expect(result.cases[0]).toMatchObject({ verdict: 'accepted', stdout: '42\n' });
    expect(factory).toHaveBeenCalledWith({
      /*
       * The name is asserted by shape, not by value, because it is a fresh
       * randomUUID per submission. It is not cosmetic: `executeSuite` persists
       * it BEFORE provisioning, so an ambiguous create failure still leaves the
       * reconciler something to stop. A sandbox created under a name we never
       * recorded is one nothing can clean up.
       */
      name: expect.stringMatching(/^quadrant-[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/),
      image: IMAGE,
      resources: { vcpus: 1 },
      timeout: 50_000,
      persistent: false,
      networkPolicy: 'deny-all',
      ports: [],
      env: {},
    });
    expect(fixture.stop).toHaveBeenCalledOnce();
    expect(cleanupFinished).toHaveBeenCalledWith(true);
  });

  it('always attempts cleanup when command control fails', async () => {
    const fixture = fakeSandbox();
    fixture.sandbox.runCommand = async () => {
      throw new Error('control plane');
    };
    const provider = new VercelSandboxProvider(IMAGE, async () => fixture.sandbox);
    await expect(
      provider.execute({
        language: 'c11',
        source: 'int main(){}',
        stdin: null,
        expectedOutput: null,
      }),
    ).rejects.toBeInstanceOf(ProviderUnavailableError);
    expect(fixture.stop).toHaveBeenCalledOnce();
  });

  it('rejects mutable image references before any provisioning', () => {
    expect(() => new VercelSandboxProvider('quadrantcode-execution:latest')).toThrow(
      ProviderUnavailableError,
    );
  });

  it('truncates Unicode on code-point boundaries within the byte cap', () => {
    const value = truncateUtf8Output('🙂'.repeat(20), 32);
    expect(Buffer.byteLength(value)).toBeLessThanOrEqual(32);
    expect(value).not.toContain('\uFFFD');
    expect(value).toContain('output truncated');
  });
});

describe('pinned language commands', () => {
  it('covers all supported languages without a shell command', () => {
    expect(Object.keys(SANDBOX_COMMANDS).sort()).toEqual([
      'c11',
      'cpp17',
      'java',
      'javascript',
      'python3',
    ]);
    for (const plan of Object.values(SANDBOX_COMMANDS)) {
      expect(plan.compile.cmd).not.toMatch(/(?:^|\/)sh$/);
      expect(plan.run.cmd).not.toMatch(/(?:^|\/)sh$/);
      expect(plan.compile.args('/tmp/fixed').join(' ')).not.toContain('$(');
    }
  });

  it('keeps the documented hard ceilings', () => {
    expect(EXECUTION_LIMITS).toMatchObject({
      cpuSeconds: 2,
      wallSeconds: 5,
      memoryKb: 256_000,
      maxOutputBytes: 32_768,
      network: false,
    });
  });
});
