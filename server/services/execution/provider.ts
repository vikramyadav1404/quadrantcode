/**
 * What runs the code, behind one interface.
 *
 * Judge0 is an implementation, not the contract. The verdicts, the limits and
 * the shape of a result are ours, so swapping the provider changes nothing the
 * database records or the UI reads.
 *
 * ## Nothing here is a sandbox we built
 *
 * The ticket is explicit and it is worth repeating where the code lives:
 * **this is Judge0 with configured limits.** It is not a "production-grade
 * secure sandbox", and nothing in this codebase should call it one. The limits
 * below are the ones we set; the isolation is whatever Judge0's own
 * configuration provides, and verifying that is a deployment question this
 * project has not been able to ask yet — there is no Judge0 instance.
 */
import { Judge0Provider } from './judge0';
import type { ExecutionLanguage, ExecutionVerdict } from './types';

/**
 * The limits every execution is submitted with.
 *
 * Documented in the README as well, because a number that only exists in code
 * is a number nobody operating the system can check.
 *
 * `network: false` is the one that matters most and the one this project cannot
 * verify: it is passed to the provider, and whether the provider honours it is
 * a property of how that provider was deployed.
 */
export const EXECUTION_LIMITS = {
  /** CPU seconds the program may burn. */
  cpuSeconds: 2,
  /** Wall-clock seconds before it is killed regardless of CPU use. */
  wallSeconds: 5,
  /** Memory ceiling. */
  memoryKb: 256_000,
  /** Output beyond this is truncated rather than stored. */
  maxOutputBytes: 32_768,
  /** Submitted with networking disabled. */
  network: false,
} as const;

export type ExecutionRequest = {
  language: ExecutionLanguage;
  source: string;
  stdin: string | null;
  /**
   * What the output should be, for OUR OWN problems only.
   *
   * Always null for an external-link problem: C1 forbids storing another
   * platform's test cases, so there is nothing to compare against and no
   * verdict to derive. That is enforced by the caller, and asserted.
   */
  expectedOutput: string | null;
  limits?: {
    cpuSeconds: number;
    wallSeconds: number;
    memoryKb: number;
  };
  lifecycle?: ExecutionLifecycle;
};

export type ExecutionResult = {
  verdict: ExecutionVerdict;
  runtimeMs: number | null;
  memoryKb: number | null;
  stdout: string | null;
  stderr: string | null;
  compileOutput: string | null;
  compilerRuntimeVersion: string | null;
};

export type ExecutionLifecycle = {
  heartbeat(
    stage: 'sandbox_created' | 'compiled' | 'test_completed' | 'cleanup_started',
  ): Promise<void>;
  sandboxCreated(metadata: { name: string; expiresAt: Date | null }): Promise<void>;
  cleanupFinished(confirmed: boolean): Promise<void>;
};

export type ExecutionSuiteRequest = Omit<ExecutionRequest, 'stdin' | 'expectedOutput'> & {
  cases: ReadonlyArray<{ ordinal: number; stdin: string | null }>;
  lifecycle?: ExecutionLifecycle;
};

export type ExecutionSuiteResult = {
  compilerRuntimeVersion: string | null;
  compileOutput: string | null;
  cases: ExecutionResult[];
};

export interface ExecutionProvider {
  /** Shown in the UI and recorded, so nobody has to guess what ran their code. */
  readonly name: string;
  /** True when this provider actually executes anything. */
  readonly executes: boolean;
  execute(request: ExecutionRequest): Promise<ExecutionResult>;
}

/** Optional compile-once capability used by the Vercel Sandbox backend. */
export interface ExecutionSuiteProvider extends ExecutionProvider {
  executeSuite(request: ExecutionSuiteRequest): Promise<ExecutionSuiteResult>;
}

export function supportsExecutionSuite(
  provider: ExecutionProvider,
): provider is ExecutionSuiteProvider {
  return 'executeSuite' in provider && typeof provider.executeSuite === 'function';
}

export type ConfiguredExecutionBackend = 'vercel_sandbox' | 'judge0' | 'fake';

export type ExecutionProviderEnv = {
  EXECUTION_BACKEND?: ConfiguredExecutionBackend | undefined;
  EXECUTION_SANDBOX_IMAGE?: string | undefined;
  JUDGE0_URL?: string | undefined;
  JUDGE0_API_KEY?: string | undefined;
  NODE_ENV?: string | undefined;
};

/**
 * Resolve one explicit backend. Judge0 is never an automatic fallback from a
 * configured Sandbox backend. The legacy inference exists only for local and
 * pre-migration compatibility.
 */
export function resolveExecutionBackend(env: ExecutionProviderEnv): ConfiguredExecutionBackend {
  if (env.EXECUTION_BACKEND) {
    if (env.EXECUTION_BACKEND === 'fake' && env.NODE_ENV === 'production') {
      throw new ProviderUnavailableError('Fake execution is disabled in production');
    }
    return env.EXECUTION_BACKEND;
  }
  if (env.JUDGE0_URL) return 'judge0';
  if (env.NODE_ENV !== 'production') return 'fake';
  throw new ProviderUnavailableError('Code execution backend');
}

/**
 * The provider could not be reached, or answered with something unusable.
 *
 * Distinct from every verdict: "Judge0 is down" and "your code is wrong" must
 * never reach the user as the same message, which is the failure the ticket's
 * outage criterion is about.
 */
export class ProviderUnavailableError extends Error {
  readonly code = 'PROVIDER_UNAVAILABLE' as const;
  readonly status = 503 as const;

  constructor(
    readonly provider: string,
    cause?: unknown,
  ) {
    super(`${provider} could not run this. Your code was not executed.`);
    this.name = 'ProviderUnavailableError';
    if (cause !== undefined) this.cause = cause;
  }
}

/** A persisted job cannot be executed as configured and must not be retried. */
export class ExecutionConfigurationError extends Error {
  readonly code = 'EXECUTION_CONFIGURATION_INVALID' as const;

  constructor(message = 'This execution is no longer configured correctly.') {
    super(message);
    this.name = 'ExecutionConfigurationError';
  }
}

/**
 * A provider that executes nothing.
 *
 * **It does not run code. It cannot tell you whether your program is correct.**
 * It exists because there is no Judge0 instance — the URL is blocked on a
 * credential — and building the pipeline against nothing would mean the state
 * machine, the rate limits, the polling endpoint and the rendering rules had no
 * way to be exercised until that credential arrived.
 *
 * The verdict is derived from the source text so that a given program always
 * gives the same answer: a fake that returned random verdicts would make every
 * test flaky and every demo confusing. `executes` is false, and every surface
 * that shows a result reads it.
 */
export class FakeExecutionProvider implements ExecutionProvider {
  readonly name = 'fake';
  readonly executes = false;

  constructor(private readonly scripted?: Partial<ExecutionResult>) {}

  async execute(request: ExecutionRequest): Promise<ExecutionResult> {
    const digest = [...request.source].reduce(
      (total, character) => (total * 31 + character.charCodeAt(0)) % 100_000,
      7,
    );

    const base: ExecutionResult = {
      verdict: 'accepted',
      runtimeMs: 20 + (digest % 180),
      memoryKb: 2_048 + (digest % 4_096),
      stdout: request.stdin
        ? `(not executed) echo of stdin:\n${request.stdin}`
        : '(not executed)',
      stderr: null,
      compileOutput: null,
      compilerRuntimeVersion: null,
    };

    return { ...base, ...this.scripted };
  }
}

/** Production-safe disabled state: it never invents a verdict. */
export class UnavailableExecutionProvider implements ExecutionProvider {
  readonly name = 'unavailable';
  readonly executes = false;

  async execute(): Promise<ExecutionResult> {
    throw new ProviderUnavailableError('Code execution');
  }
}

/**
 * Which provider is in use, decided by configuration.
 *
 * Mirrors `resolveStorage` from F0.5: one place decides, and the surfaces that
 * care read `executes` rather than checking an env var themselves.
 */
export function resolveProvider(env: ExecutionProviderEnv): ExecutionProvider {
  let backend: ConfiguredExecutionBackend;
  try {
    backend = resolveExecutionBackend(env);
  } catch {
    return new UnavailableExecutionProvider();
  }

  if (backend === 'fake') return new FakeExecutionProvider();
  if (backend === 'vercel_sandbox') return new UnavailableExecutionProvider();
  if (!env.JUDGE0_URL) return new UnavailableExecutionProvider();

  return new Judge0Provider({
    baseUrl: env.JUDGE0_URL,
    ...(env.JUDGE0_API_KEY ? { apiKey: env.JUDGE0_API_KEY } : {}),
  });
}
