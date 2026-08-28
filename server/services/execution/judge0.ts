/**
 * Judge0, behind the provider interface.
 *
 * ## This code has never run against a Judge0 instance
 *
 * There is no `JUDGE0_URL`. Everything below is written from Judge0's published
 * API and is **UNVERIFIED** — the status-id mapping, the base64 handling, the
 * shape of the error responses. It is here so that supplying the URL is a
 * configuration change rather than a development task, and it is recorded as
 * BLOCKED rather than DONE.
 *
 * The parts that are verified are the ones that do not need an instance: the
 * status mapping is a pure function with its own tests, and everything that
 * consumes a result is exercised through the fake provider.
 *
 * ## What the limits are, and are not
 *
 * The numbers in `EXECUTION_LIMITS` are submitted with every request. Whether
 * they are honoured — and whether the network really is disabled — is a
 * property of how the Judge0 instance was deployed, not of this file. **This is
 * Judge0 with configured limits, not a sandbox this project built.**
 */
import {
  EXECUTION_LIMITS,
  type ExecutionProvider,
  type ExecutionRequest,
  type ExecutionResult,
  ProviderUnavailableError,
} from './provider';
import type { ExecutionLanguage, ExecutionVerdict } from './types';

/**
 * Judge0's language ids.
 *
 * Numbers, and version-specific — a Judge0 upgrade can move them, which is
 * exactly the kind of drift an interface exists to contain. Verify these against
 * `GET /languages` on the instance before trusting a first run.
 */
export const JUDGE0_LANGUAGE_IDS: Record<ExecutionLanguage, number> = {
  cpp17: 54, // C++ (GCC 9.2.0)
  java: 62, // Java (OpenJDK 13.0.1)
  python3: 71, // Python (3.8.1)
  javascript: 63, // JavaScript (Node.js 12.14.0)
};

/**
 * Judge0 status id → our verdict.
 *
 * Pure, exported and tested, because it is the one part of this file that can
 * be checked without an instance. Judge0's ids:
 *
 *   1 in queue · 2 processing · 3 accepted · 4 wrong answer
 *   5 time limit exceeded · 6 compilation error
 *   7–12 runtime errors (SIGSEGV, SIGXFSZ, SIGFPE, SIGABRT, NZEC, other)
 *   13 internal error · 14 exec format error
 *
 * Note 7 and 8: SIGSEGV and SIGXFSZ are runtime errors here rather than memory
 * or output verdicts. Judge0 reports memory exhaustion as a signal, so `mle`
 * is inferred from the reported memory against our own ceiling instead — the
 * mapping alone cannot tell a segfault from an allocation failure.
 */
export function verdictForStatus(statusId: number): ExecutionVerdict {
  if (statusId === 3) return 'accepted';
  if (statusId === 4) return 'wrong_answer';
  if (statusId === 5) return 'tle';
  if (statusId === 6) return 'compile_error';
  if (statusId >= 7 && statusId <= 12) return 'runtime_error';

  /*
   * 1 and 2 are "still going" and must never reach here: the caller polls until
   * the submission is finished. Reaching this with a live status means the poll
   * gave up, which is an internal failure rather than anything about the code.
   */
  return 'internal_error';
}

type Judge0Submission = {
  status?: { id?: number };
  time?: string | null;
  memory?: number | null;
  stdout?: string | null;
  stderr?: string | null;
  compile_output?: string | null;
};

export class Judge0Provider implements ExecutionProvider {
  readonly name = 'judge0';
  readonly executes = true;

  constructor(
    private readonly config: {
      baseUrl: string;
      apiKey?: string;
      /** How long to keep polling before giving up. */
      pollTimeoutMs?: number;
      pollIntervalMs?: number;
    },
  ) {}

  async execute(request: ExecutionRequest): Promise<ExecutionResult> {
    const token = await this.submit(request);
    const submission = await this.pollUntilFinished(token);

    const statusId = submission.status?.id ?? 13;
    const memoryKb = submission.memory ?? null;

    /*
     * Memory is checked against OUR ceiling rather than trusting a status id.
     * Judge0 reports an allocation failure as a signal, indistinguishable from
     * a segfault, so a program killed for memory would otherwise be reported as
     * a runtime error — which sends the user looking for the wrong bug.
     */
    const verdict: ExecutionVerdict =
      memoryKb !== null && memoryKb >= EXECUTION_LIMITS.memoryKb
        ? 'mle'
        : verdictForStatus(statusId);

    return {
      verdict,
      runtimeMs: submission.time ? Math.round(Number(submission.time) * 1000) : null,
      memoryKb,
      stdout: truncate(submission.stdout),
      stderr: truncate(submission.stderr),
      compileOutput: truncate(submission.compile_output),
    };
  }

  private async submit(request: ExecutionRequest): Promise<string> {
    const response = await this.fetchJson('/submissions?base64_encoded=false&wait=false', {
      method: 'POST',
      body: JSON.stringify({
        language_id: JUDGE0_LANGUAGE_IDS[request.language],
        source_code: request.source,
        stdin: request.stdin ?? '',
        expected_output: request.expectedOutput ?? null,
        cpu_time_limit: EXECUTION_LIMITS.cpuSeconds,
        wall_time_limit: EXECUTION_LIMITS.wallSeconds,
        memory_limit: EXECUTION_LIMITS.memoryKb,
        enable_network: EXECUTION_LIMITS.network,
      }),
    });

    const token = (response as { token?: string }).token;
    if (!token) throw new ProviderUnavailableError(this.name, 'submission returned no token');

    return token;
  }

  private async pollUntilFinished(token: string): Promise<Judge0Submission> {
    const timeout = this.config.pollTimeoutMs ?? 15_000;
    const interval = this.config.pollIntervalMs ?? 400;
    const deadline = Date.now() + timeout;

    while (Date.now() < deadline) {
      const submission = (await this.fetchJson(
        `/submissions/${token}?base64_encoded=false`,
      )) as Judge0Submission;

      const statusId = submission.status?.id ?? 0;
      // 1 = in queue, 2 = processing. Anything else is finished.
      if (statusId > 2) return submission;

      await new Promise((resolve) => setTimeout(resolve, interval));
    }

    /*
     * Giving up is NOT a verdict. The code may well have run; we stopped
     * waiting. Reporting it as `internal_error` here would put a result in the
     * database for something we never saw finish.
     */
    throw new ProviderUnavailableError(this.name, 'timed out waiting for a result');
  }

  private async fetchJson(path: string, init: RequestInit = {}): Promise<unknown> {
    try {
      const response = await fetch(`${this.config.baseUrl}${path}`, {
        ...init,
        headers: {
          'content-type': 'application/json',
          ...(this.config.apiKey ? { 'X-Auth-Token': this.config.apiKey } : {}),
          ...init.headers,
        },
      });

      if (!response.ok) {
        throw new ProviderUnavailableError(this.name, `HTTP ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      if (error instanceof ProviderUnavailableError) throw error;
      throw new ProviderUnavailableError(this.name, error);
    }
  }
}

/** Output is capped rather than stored whole: a runaway loop can print forever. */
function truncate(value: string | null | undefined): string | null {
  if (!value) return null;
  if (value.length <= EXECUTION_LIMITS.maxOutputBytes) return value;

  return `${value.slice(0, EXECUTION_LIMITS.maxOutputBytes)}\n… output truncated`;
}
