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

export type Judge0Language = {
  id: number;
  name: string;
  is_archived?: boolean;
};

/** Match runtime families by name; numeric ids are discovered from this instance. */
export const JUDGE0_LANGUAGE_MATCHERS: Record<ExecutionLanguage, RegExp> = {
  c11: /^C \((?:GCC|Clang) /i,
  cpp17: /^C\+\+ \((?:GCC|Clang) /i,
  java: /^Java \(/i,
  python3: /^Python \(/i,
  javascript: /^JavaScript \(Node\.js /i,
};

export function selectJudge0Language(
  languages: readonly Judge0Language[],
  requested: ExecutionLanguage,
): Judge0Language | null {
  const matcher = JUDGE0_LANGUAGE_MATCHERS[requested];
  return (
    languages
      .filter((language) => !language.is_archived && matcher.test(language.name))
      .sort((left, right) => right.id - left.id)[0] ?? null
  );
}

/**
 * Explicit language ids, because "highest id" is not "newest runtime".
 *
 * `selectJudge0Language` sorts by id descending as a proxy for recency. On a
 * real Judge0 CE instance that proxy is wrong in two places, both found by
 * querying the live catalogue rather than by reading this code:
 *
 *   c11     id 75 `C (Clang 7.0.1)`   beat  id 50 `C (GCC 9.2.0)`
 *   cpp17   id 76 `C++ (Clang 7.0.1)` beat  id 54 `C++ (GCC 9.2.0)`
 *
 * Clang 7 predates complete C++17 library support — `<charconv>` and parts of
 * `<filesystem>` are missing — so the heuristic was selecting the WORSE
 * compiler for the standard we advertise in the language label.
 *
 * `python3` is pinned for a different and sharper reason: its matcher is
 * `/^Python \(/`, which also matches `Python (2.7.17)` (id 70). Today id 71 is
 * 3.8.1 and the sort happens to win, but that is luck, not design — an
 * instance that exposed a higher-id Python 2 would silently run Python 2 for
 * every submission and every reference validation. A pin costs one line; the
 * failure costs a corrupt publication record.
 *
 * `java` and `javascript` are deliberately left unpinned: each has exactly one
 * candidate on the instance, so a pin would add a number to maintain without
 * removing any ambiguity.
 *
 * Ids are stable across Judge0 CE deployments because they are seeded from the
 * same fixture. `npm run judge0:languages` re-checks them against the live
 * instance and fails on drift.
 */
export const JUDGE0_PINNED_LANGUAGE_IDS: Partial<Record<ExecutionLanguage, number>> = {
  c11: 50,
  cpp17: 54,
  python3: 71,
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
      /** Deployment override for instances whose runtime names are non-standard. */
      languageIds?: Partial<Record<ExecutionLanguage, number>>;
    },
  ) {}

  private languageCatalogPromise: Promise<Judge0Language[]> | null = null;

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
      memoryKb !== null && memoryKb >= (request.limits?.memoryKb ?? EXECUTION_LIMITS.memoryKb)
        ? 'mle'
        : verdictForStatus(statusId);

    return {
      verdict,
      runtimeMs: submission.time ? Math.round(Number(submission.time) * 1000) : null,
      memoryKb,
      stdout: truncate(decodeField(submission.stdout)),
      stderr: truncate(decodeField(submission.stderr)),
      compileOutput: truncate(decodeField(submission.compile_output)),
      compilerRuntimeVersion: (await this.languageFor(request.language)).name,
    };
  }

  private async submit(request: ExecutionRequest): Promise<string> {
    const language = await this.languageFor(request.language);
    const limits = request.limits ?? EXECUTION_LIMITS;
    const response = await this.fetchJson(`${SUBMISSIONS_PATH}&wait=false`, {
      method: 'POST',
      body: JSON.stringify({
        language_id: language.id,
        source_code: encodeField(request.source),
        stdin: encodeField(request.stdin ?? ''),
        expected_output: encodeField(request.expectedOutput),
        cpu_time_limit: limits.cpuSeconds,
        wall_time_limit: limits.wallSeconds,
        memory_limit: limits.memoryKb,
        enable_network: EXECUTION_LIMITS.network,
      }),
    });

    const token = (response as { token?: string }).token;
    if (!token) throw new ProviderUnavailableError(this.name, 'submission returned no token');

    return token;
  }

  private async languageFor(requested: ExecutionLanguage): Promise<Judge0Language> {
    const configured = this.config.languageIds?.[requested];

    this.languageCatalogPromise ??= this.fetchJson('/languages').then((payload) => {
      if (!Array.isArray(payload)) {
        throw new ProviderUnavailableError(this.name, 'languages endpoint returned no array');
      }

      return payload.filter(
        (item): item is Judge0Language =>
          typeof item === 'object' &&
          item !== null &&
          typeof (item as Judge0Language).id === 'number' &&
          typeof (item as Judge0Language).name === 'string',
      );
    });

    const catalogue = await this.languageCatalogPromise;

    /*
     * A pin selects the id, but the NAME still comes from the catalogue.
     *
     * This used to short-circuit before fetching and return a synthetic
     * `"c11 (configured id 50)"`. That name is not cosmetic: it is what
     * `execute()` returns as `compilerRuntimeVersion`, which F4.1 stores in
     * `problemVersions.referenceValidationSummary.runtimeVersions` as the
     * evidence that a problem's reference solutions were validated against a
     * known runtime. Pinning would therefore have replaced real provenance
     * ("C (GCC 9.2.0)") with a restatement of our own config, on every problem
     * published from then on.
     *
     * The synthetic name survives only as a fallback, for an instance that
     * accepts the id but does not list it.
     */
    if (configured !== undefined) {
      return (
        catalogue.find((language) => language.id === configured) ?? {
          id: configured,
          name: `${requested} (configured id ${configured})`,
        }
      );
    }

    const selected = selectJudge0Language(catalogue, requested);
    if (!selected) {
      throw new ProviderUnavailableError(
        this.name,
        `configured instance does not expose ${requested}`,
      );
    }
    return selected;
  }

  private async pollUntilFinished(token: string): Promise<Judge0Submission> {
    const timeout = this.config.pollTimeoutMs ?? 15_000;
    const interval = this.config.pollIntervalMs ?? 400;
    const deadline = Date.now() + timeout;

    while (Date.now() < deadline) {
      const submission = (await this.fetchJson(
        `/submissions/${token}?base64_encoded=true`,
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

/**
 * Every payload field is base64, in BOTH directions. This is not an optimisation.
 *
 * The provider used to submit and retrieve with `base64_encoded=false`, and
 * that is broken against a real instance: retrieving a submission whose output
 * is not clean UTF-8 returns
 *
 *   HTTP 400 {"error":"some attributes for this submission cannot be converted
 *             to UTF-8, use base64_encoded=true query parameter"}
 *
 * which `fetchJson` turns into `ProviderUnavailableError` — reported to the
 * user as "your code was not executed" when in fact it ran to completion and
 * the result was thrown away at the last step.
 *
 * It is not an edge case. GCC 9.2.0 writes diagnostics with typographic quotes
 * (`In function ‘main’:`), so ANY C or C++ submission that produces a compiler
 * warning hits it — and the user sees an infrastructure failure instead of
 * their own compile error. Clang 7 happened not to, which is why the plain
 * path appeared to work until C/C++ were pinned to GCC.
 *
 * Found by running the code against the instance, not by reading it — the
 * file header said the base64 handling was unverified, and it was wrong.
 */
const SUBMISSIONS_PATH = '/submissions?base64_encoded=true';

function encodeField(value: string | null): string | null {
  return value === null ? null : Buffer.from(value, 'utf8').toString('base64');
}

/**
 * Judge0 returns base64 for the text fields. A field that is not valid base64
 * is passed through rather than discarded: a mangled result is more useful to
 * whoever is debugging than a silent null.
 */
function decodeField(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    return Buffer.from(value, 'base64').toString('utf8');
  } catch {
    return value;
  }
}

/** Output is capped rather than stored whole: a runaway loop can print forever. */
function truncate(value: string | null | undefined): string | null {
  if (!value) return null;
  if (value.length <= EXECUTION_LIMITS.maxOutputBytes) return value;

  return `${value.slice(0, EXECUTION_LIMITS.maxOutputBytes)}\n… output truncated`;
}
