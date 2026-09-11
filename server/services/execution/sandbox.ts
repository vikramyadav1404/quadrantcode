import { randomUUID } from 'node:crypto';
import { Sandbox } from '@vercel/sandbox';
import type { ExecutionLanguage, ExecutionVerdict } from './types';
import {
  EXECUTION_LIMITS,
  ProviderUnavailableError,
  type ExecutionRequest,
  type ExecutionResult,
  type ExecutionSuiteProvider,
  type ExecutionSuiteRequest,
  type ExecutionSuiteResult,
} from './provider';
import {
  IMMUTABLE_SANDBOX_IMAGE,
  sandboxCommandResultSchema,
  sandboxToolchainSchema,
  type SandboxCommandResult,
} from './sandbox-protocol';

const SANDBOX_TIMEOUT_MS = 50_000;
const COMPILE_TIMEOUT_MS = 8_000;
const COMPILE_MEMORY_KB = 512 * 1_024;
const MAX_CASES = 6;
const TOOLCHAIN_FILE = '/opt/quadrant/toolchain-runtime.json';

type SandboxFileSystem = {
  writeFile(path: string, data: string | Buffer | Uint8Array): Promise<void>;
  readFile(path: string, encoding: 'utf8'): Promise<string>;
  mkdir(path: string, options?: { recursive?: boolean }): Promise<string | undefined>;
  rm(path: string, options?: { recursive?: boolean; force?: boolean }): Promise<void>;
};

export type ExecutionSandbox = {
  readonly name: string;
  readonly expiresAt: Date | undefined;
  readonly fs: SandboxFileSystem;
  runCommand(params: {
    cmd: string;
    args?: string[];
    cwd?: string;
    env?: Record<string, string>;
    sudo?: boolean;
    timeoutMs?: number;
  }): Promise<{ exitCode: number }>;
  stop(): Promise<unknown>;
};

export type SandboxFactory = (input: {
  name: string;
  image: string;
  resources: { vcpus: number };
  timeout: number;
  persistent: false;
  networkPolicy: 'deny-all';
  ports: [];
  env: Record<string, string>;
}) => Promise<ExecutionSandbox>;

const createSandbox: SandboxFactory = async (input) => Sandbox.create(input);

type CommandPlan = {
  sourceName: string;
  compile: { cmd: string; args: (workspace: string) => string[] };
  run: { cmd: string; args: (workspace: string, memoryKb: number) => string[] };
};

export const SANDBOX_COMMANDS: Record<ExecutionLanguage, CommandPlan> = {
  c11: {
    sourceName: 'main.c',
    compile: {
      cmd: '/usr/bin/gcc',
      args: (workspace) => [
        '-std=c11',
        '-O2',
        '-pipe',
        '-fno-omit-frame-pointer',
        '-o',
        `${workspace}/program`,
        `${workspace}/main.c`,
      ],
    },
    run: { cmd: '/tmp/unused', args: () => [] },
  },
  cpp17: {
    sourceName: 'main.cpp',
    compile: {
      cmd: '/usr/bin/g++',
      args: (workspace) => [
        '-std=c++17',
        '-O2',
        '-pipe',
        '-fno-omit-frame-pointer',
        '-o',
        `${workspace}/program`,
        `${workspace}/main.cpp`,
      ],
    },
    run: { cmd: '/tmp/unused', args: () => [] },
  },
  java: {
    sourceName: 'Main.java',
    compile: {
      cmd: '/usr/bin/javac',
      args: (workspace) => ['-encoding', 'UTF-8', '-d', workspace, `${workspace}/Main.java`],
    },
    run: {
      cmd: '/usr/bin/java',
      args: (workspace, memoryKb) => [
        `-Xmx${Math.max(16, Math.floor(memoryKb / 1_024))}m`,
        '-cp',
        workspace,
        'Main',
      ],
    },
  },
  python3: {
    sourceName: 'submission.py',
    compile: {
      cmd: '/usr/bin/python3',
      args: (workspace) => ['-I', '-m', 'py_compile', `${workspace}/submission.py`],
    },
    run: {
      cmd: '/usr/bin/python3',
      args: (workspace) => ['-I', '-B', `${workspace}/submission.py`],
    },
  },
  javascript: {
    sourceName: 'submission.js',
    compile: {
      cmd: '/usr/bin/node',
      args: (workspace) => ['--check', `${workspace}/submission.js`],
    },
    run: {
      cmd: '/usr/bin/node',
      args: (workspace, memoryKb) => [
        '--disable-proto=throw',
        '--no-addons',
        `--max-old-space-size=${Math.max(16, Math.floor(memoryKb / 1_024))}`,
        `${workspace}/submission.js`,
      ],
    },
  },
};

/** Executes a complete submission in one ephemeral, network-denied Sandbox. */
export class VercelSandboxProvider implements ExecutionSuiteProvider {
  readonly name = 'vercel-sandbox';
  readonly executes = true;

  constructor(
    private readonly image: string,
    private readonly factory: SandboxFactory = createSandbox,
  ) {
    if (!IMMUTABLE_SANDBOX_IMAGE.test(image)) {
      throw new ProviderUnavailableError('Vercel Sandbox image');
    }
  }

  async execute(request: ExecutionRequest): Promise<ExecutionResult> {
    const result = await this.executeSuite({
      language: request.language,
      source: request.source,
      limits: request.limits,
      cases: [{ ordinal: 1, stdin: request.stdin }],
      lifecycle: request.lifecycle,
    });
    return result.cases[0]!;
  }

  async executeSuite(request: ExecutionSuiteRequest): Promise<ExecutionSuiteResult> {
    if (request.cases.length === 0 || request.cases.length > MAX_CASES) {
      throw new ProviderUnavailableError('Vercel Sandbox execution plan');
    }

    let sandbox: ExecutionSandbox | null = null;
    let originalError: unknown;
    const workspace = `/tmp/quadrant-${randomUUID()}`;
    const name = `quadrant-${randomUUID()}`;

    try {
      // Persist the name BEFORE provisioning: an ambiguous create failure is
      // recoverable by the cleanup reconciler. The VM is always ephemeral.
      await request.lifecycle?.sandboxCreated({
        name,
        expiresAt: new Date(Date.now() + 120_000),
      });
      sandbox = await this.factory({
        name,
        image: this.image,
        resources: { vcpus: 1 },
        timeout: SANDBOX_TIMEOUT_MS,
        persistent: false,
        networkPolicy: 'deny-all',
        ports: [],
        env: {},
      });
      await request.lifecycle?.sandboxCreated({
        name: sandbox.name,
        expiresAt: sandbox.expiresAt ?? new Date(Date.now() + SANDBOX_TIMEOUT_MS),
      });
      await request.lifecycle?.heartbeat('sandbox_created');

      const prepared = await sandbox.runCommand({
        cmd: '/usr/local/bin/quadrant-exec',
        args: ['--prepare-workspace', workspace],
        env: {},
        sudo: true,
        timeoutMs: 2_000,
      });
      if (prepared.exitCode !== 0) throw new ProviderUnavailableError('Sandbox workspace');
      const buildDirectory = `${workspace}/build`;
      await sandbox.fs.mkdir(buildDirectory, { recursive: true });
      const plan = SANDBOX_COMMANDS[request.language];
      await sandbox.fs.writeFile(`${buildDirectory}/${plan.sourceName}`, request.source);
      const toolchain = sandboxToolchainSchema.parse(
        JSON.parse(await sandbox.fs.readFile(TOOLCHAIN_FILE, 'utf8')),
      );

      const compile = await this.runLimited(sandbox, {
        workspace: buildDirectory,
        stem: 'compile',
        stdin: null,
        command: plan.compile.cmd,
        args: plan.compile.args(buildDirectory),
        cpuMs: COMPILE_TIMEOUT_MS,
        wallMs: COMPILE_TIMEOUT_MS,
        memoryKb: COMPILE_MEMORY_KB,
      });
      await request.lifecycle?.heartbeat('compiled');

      const compileOutput = joinOutput(compile.stdout, compile.stderr);
      await removeCommandFiles(sandbox, buildDirectory, 'compile');
      if (compile.meta.status !== 'exited' || compile.meta.exitCode !== 0) {
        return {
          compilerRuntimeVersion: toolchain[request.language],
          compileOutput,
          cases: request.cases.map(() => ({
            verdict: 'compile_error' as const,
            runtimeMs: compile.meta.wallMs,
            memoryKb: compile.meta.memoryKb,
            stdout: null,
            stderr: compile.stderr,
            compileOutput,
            compilerRuntimeVersion: toolchain[request.language],
          })),
        };
      }

      const sealed = await sandbox.runCommand({
        cmd: '/usr/local/bin/quadrant-exec',
        args: ['--seal-workspace', workspace],
        env: {},
        sudo: true,
        timeoutMs: 2_000,
      });
      if (sealed.exitCode !== 0) throw new ProviderUnavailableError('Sandbox workspace seal');

      const limits = request.limits ?? EXECUTION_LIMITS;
      const cases: ExecutionResult[] = [];
      for (const test of request.cases) {
        const caseDirectory = `${workspace}/case-${test.ordinal}`;
        const casePrepared = await sandbox.runCommand({
          cmd: '/usr/local/bin/quadrant-exec',
          args: ['--prepare-case', caseDirectory],
          env: {},
          sudo: true,
          timeoutMs: 2_000,
        });
        if (casePrepared.exitCode !== 0) {
          throw new ProviderUnavailableError('Sandbox test workspace');
        }
        const runCommand =
          request.language === 'c11' || request.language === 'cpp17'
            ? `${buildDirectory}/program`
            : plan.run.cmd;
        const run = await this.runLimited(sandbox, {
          workspace: caseDirectory,
          stem: `test-${test.ordinal}`,
          stdin: test.stdin,
          command: runCommand,
          args: plan.run.args(buildDirectory, limits.memoryKb),
          cpuMs: Math.round(limits.cpuSeconds * 1_000),
          wallMs: Math.round(limits.wallSeconds * 1_000),
          memoryKb: limits.memoryKb,
        });
        const caseCleaned = await sandbox.runCommand({
          cmd: '/usr/local/bin/quadrant-exec',
          args: ['--cleanup-case', caseDirectory],
          env: {},
          sudo: true,
          timeoutMs: 2_000,
        });
        if (caseCleaned.exitCode !== 0) {
          throw new ProviderUnavailableError('Sandbox test cleanup');
        }
        cases.push({
          verdict: verdictForCommand(run.meta),
          runtimeMs: run.meta.wallMs,
          memoryKb: run.meta.memoryKb,
          stdout: run.stdout,
          stderr: run.stderr,
          compileOutput,
          compilerRuntimeVersion: toolchain[request.language],
        });
        await request.lifecycle?.heartbeat('test_completed');
      }
      return {
        compilerRuntimeVersion: toolchain[request.language],
        compileOutput,
        cases,
      };
    } catch (error) {
      originalError = error;
      if (error instanceof ProviderUnavailableError) throw error;
      throw new ProviderUnavailableError('Vercel Sandbox', error);
    } finally {
      if (sandbox) {
        await request.lifecycle?.heartbeat('cleanup_started').catch(() => undefined);
        let confirmed = false;
        try {
          const cleaned = await sandbox.runCommand({
            cmd: '/usr/local/bin/quadrant-exec',
            args: ['--cleanup-workspace', workspace],
            env: {},
            sudo: true,
            timeoutMs: 2_000,
          });
          if (cleaned.exitCode !== 0) throw new Error('workspace cleanup was not confirmed');
          await sandbox.fs.rm(workspace, { recursive: true, force: true });
        } catch {
          // Stopping the ephemeral VM below is the authoritative cleanup.
        }
        try {
          await sandbox.stop();
          confirmed = true;
        } catch {
          // Preserve the original failure, but never finalize a successful
          // attempt when termination has not been confirmed.
        }
        await request.lifecycle?.cleanupFinished(confirmed).catch(() => undefined);
        if (!confirmed && originalError === undefined) {
          throw new ProviderUnavailableError('Vercel Sandbox cleanup');
        }
      }
    }
  }

  private async runLimited(
    sandbox: ExecutionSandbox,
    input: {
      workspace: string;
      stem: string;
      stdin: string | null;
      command: string;
      args: string[];
      cpuMs: number;
      wallMs: number;
      memoryKb: number;
    },
  ): Promise<{ meta: SandboxCommandResult; stdout: string; stderr: string }> {
    const prefix = `${input.workspace}/${input.stem}`;
    const stdinPath = `${prefix}.stdin`;
    const stdoutPath = `${prefix}.stdout`;
    const stderrPath = `${prefix}.stderr`;
    const resultPath = `${prefix}.json`;
    await sandbox.fs.writeFile(stdinPath, input.stdin ?? '');

    const finished = await sandbox.runCommand({
      cmd: '/usr/local/bin/quadrant-exec',
      args: [
        '--stdin',
        stdinPath,
        '--stdout',
        stdoutPath,
        '--stderr',
        stderrPath,
        '--result',
        resultPath,
        '--cpu-ms',
        String(input.cpuMs),
        '--wall-ms',
        String(input.wallMs),
        '--memory-kb',
        String(input.memoryKb),
        '--output-bytes',
        String(EXECUTION_LIMITS.maxOutputBytes),
        '--cwd',
        input.workspace,
        '--',
        input.command,
        ...input.args,
      ],
      cwd: input.workspace,
      env: {},
      sudo: true,
      timeoutMs: input.wallMs + 2_000,
    });
    if (finished.exitCode !== 0) throw new ProviderUnavailableError('Sandbox supervisor');

    const meta = sandboxCommandResultSchema.parse(
      JSON.parse(await sandbox.fs.readFile(resultPath, 'utf8')),
    );
    const rawStdout = await sandbox.fs.readFile(stdoutPath, 'utf8');
    const rawStderr = await sandbox.fs.readFile(stderrPath, 'utf8');
    const stdout = truncateUtf8Output(rawStdout);
    const remainingBytes = Math.max(
      0,
      EXECUTION_LIMITS.maxOutputBytes - Buffer.byteLength(stdout),
    );
    const stderr = truncateUtf8Output(rawStderr, remainingBytes);
    return { meta, stdout, stderr };
  }
}

function verdictForCommand(result: SandboxCommandResult): ExecutionVerdict {
  if (result.status === 'timed_out') return 'tle';
  if (result.status === 'oom') return 'mle';
  if (result.status === 'output_limit' || result.status === 'signaled') return 'runtime_error';
  return result.exitCode === 0 ? 'accepted' : 'runtime_error';
}

export function truncateUtf8Output(
  value: string,
  maximumBytes: number = EXECUTION_LIMITS.maxOutputBytes,
): string {
  const bytes = Buffer.from(value);
  if (bytes.byteLength <= maximumBytes) return value;
  const suffix = Buffer.from('\n… output truncated');
  if (maximumBytes <= 0) return '';
  if (maximumBytes <= suffix.byteLength) {
    return validUtf8Prefix(suffix, maximumBytes);
  }
  const budget = Math.max(0, maximumBytes - suffix.byteLength);
  const prefix = validUtf8Prefix(bytes, budget);
  return `${prefix}${suffix.toString('utf8')}`;
}

function validUtf8Prefix(bytes: Buffer, maximumBytes: number): string {
  let end = Math.min(bytes.byteLength, maximumBytes);
  let value = bytes.subarray(0, end).toString('utf8');
  while (value.endsWith('\uFFFD') && end > Math.max(0, maximumBytes - 4)) {
    end -= 1;
    value = bytes.subarray(0, end).toString('utf8');
  }
  return value;
}

function joinOutput(stdout: string, stderr: string): string | null {
  const value = [stdout, stderr].filter(Boolean).join('\n');
  return value === '' ? null : truncateUtf8Output(value);
}

async function removeCommandFiles(
  sandbox: ExecutionSandbox,
  workspace: string,
  stem: string,
): Promise<void> {
  await Promise.all(
    ['stdin', 'stdout', 'stderr', 'json'].map((extension) =>
      sandbox.fs.rm(`${workspace}/${stem}.${extension}`, { force: true }),
    ),
  );
}
