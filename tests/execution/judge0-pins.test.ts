/**
 * F3.1 · language pinning, runtime labels, and the base64 payload contract.
 *
 * All three came out of running `Judge0Provider` against a real instance for
 * the first time. Each test below corresponds to something that was actually
 * wrong, not to something that might be:
 *
 *   1. "highest id" selected `C (Clang 7.0.1)` over `C (GCC 9.2.0)`
 *   2. a pinned id replaced the real runtime name with a restatement of our
 *      own config, which F4.1 stores as publication evidence
 *   3. `base64_encoded=false` made every GCC compiler warning a 400
 *
 * The live half — that the pinned ids exist on the instance and that the
 * labels match — is `npm run judge0:languages`, because it needs a token and
 * a reachable instance. This file covers what holds without either.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  JUDGE0_LANGUAGE_MATCHERS,
  JUDGE0_PINNED_LANGUAGE_IDS,
  Judge0Provider,
  type Judge0Language,
  selectJudge0Language,
} from '@/server/services/execution/judge0';
import {
  EXECUTION_LANGUAGES,
  EXECUTION_RUNTIME_CAVEATS,
  EXECUTION_RUNTIME_LABELS,
  type ExecutionLanguage,
} from '@/lib/execution/languages';

/**
 * The catalogue the production instance actually returns, trimmed to the
 * entries that matter. Recorded from `GET /languages` on 2026-09-22 — these
 * are real ids and real names, not invented ones.
 */
const INSTANCE: Judge0Language[] = [
  { id: 48, name: 'C (GCC 7.4.0)' },
  { id: 49, name: 'C (GCC 8.3.0)' },
  { id: 50, name: 'C (GCC 9.2.0)' },
  { id: 52, name: 'C++ (GCC 7.4.0)' },
  { id: 53, name: 'C++ (GCC 8.3.0)' },
  { id: 54, name: 'C++ (GCC 9.2.0)' },
  { id: 62, name: 'Java (OpenJDK 13.0.1)' },
  { id: 63, name: 'JavaScript (Node.js 12.14.0)' },
  { id: 70, name: 'Python (2.7.17)' },
  { id: 71, name: 'Python (3.8.1)' },
  { id: 75, name: 'C (Clang 7.0.1)' },
  { id: 76, name: 'C++ (Clang 7.0.1)' },
];

describe('F3.1 · every language has a runtime label', () => {
  it.each(EXECUTION_LANGUAGES)('%s', (language) => {
    expect(EXECUTION_RUNTIME_LABELS[language]).toBeTruthy();
  });

  it('labels no language that is not executable', () => {
    for (const key of Object.keys(EXECUTION_RUNTIME_LABELS)) {
      expect(EXECUTION_LANGUAGES).toContain(key as ExecutionLanguage);
    }
    for (const key of Object.keys(EXECUTION_RUNTIME_CAVEATS)) {
      expect(EXECUTION_LANGUAGES).toContain(key as ExecutionLanguage);
    }
  });

  it('caveats only the runtimes old enough to reject current syntax', () => {
    // Node 12 predates ?. and ??; Python 3.8 predates match. The other three
    // fail nothing a user would reasonably write, so annotating them is noise.
    expect(Object.keys(EXECUTION_RUNTIME_CAVEATS).sort()).toEqual(['javascript', 'python3']);
  });
});

describe('F3.1 · the unpinned heuristic is wrong on a real catalogue', () => {
  /**
   * The positive control for the pin. If this ever starts returning GCC, the
   * heuristic has changed and the pins may no longer be needed — but until
   * then this is the bug they exist to work around.
   */
  it('selects Clang 7 over GCC 9.2 for C and C++, because its id is higher', () => {
    expect(selectJudge0Language(INSTANCE, 'c11')).toEqual({ id: 75, name: 'C (Clang 7.0.1)' });
    expect(selectJudge0Language(INSTANCE, 'cpp17')).toEqual({
      id: 76,
      name: 'C++ (Clang 7.0.1)',
    });
  });

  it("matches BOTH Pythons, so python3's correctness rests on id order alone", () => {
    const matcher = JUDGE0_LANGUAGE_MATCHERS.python3;
    const matched = INSTANCE.filter((entry) => matcher.test(entry.name)).map((e) => e.name);
    expect(matched).toEqual(['Python (2.7.17)', 'Python (3.8.1)']);

    // It happens to win today. An instance exposing a higher-id Python 2 would
    // silently run Python 2 for every submission — hence the pin.
    expect(selectJudge0Language(INSTANCE, 'python3')?.id).toBe(71);
  });
});

describe('F3.1 · the pins', () => {
  it('pins C and C++ to GCC 9.2.0, and python3 away from Python 2', () => {
    expect(JUDGE0_PINNED_LANGUAGE_IDS).toEqual({ c11: 50, cpp17: 54, python3: 71 });
  });

  it('every pinned id exists on the instance and matches its own language', () => {
    for (const [language, id] of Object.entries(JUDGE0_PINNED_LANGUAGE_IDS)) {
      const entry = INSTANCE.find((candidate) => candidate.id === id);
      expect(entry, `${language} -> id ${id}`).toBeDefined();
      expect(JUDGE0_LANGUAGE_MATCHERS[language as ExecutionLanguage].test(entry!.name)).toBe(
        true,
      );
    }
  });

  it('pins only where there is a real choice to get wrong', () => {
    // java and javascript have exactly one candidate each, so a pin would be a
    // number to maintain that removes no ambiguity.
    for (const language of ['java', 'javascript'] as const) {
      const matcher = JUDGE0_LANGUAGE_MATCHERS[language];
      expect(INSTANCE.filter((entry) => matcher.test(entry.name))).toHaveLength(1);
      expect(JUDGE0_PINNED_LANGUAGE_IDS[language]).toBeUndefined();
    }
  });

  it('resolves each pin to the runtime its label claims', () => {
    const normalise = (value: string) =>
      value.replace(/[()]/g, ' ').replace(/\s+/g, ' ').trim();
    for (const [language, id] of Object.entries(JUDGE0_PINNED_LANGUAGE_IDS)) {
      const entry = INSTANCE.find((candidate) => candidate.id === id)!;
      const claimed = EXECUTION_RUNTIME_LABELS[language as ExecutionLanguage];
      expect(normalise(entry.name), `${language} label`).toContain(normalise(claimed));
    }
  });

  it('every UNPINNED language also resolves to the runtime its label claims', () => {
    const normalise = (value: string) =>
      value.replace(/[()]/g, ' ').replace(/\s+/g, ' ').trim();
    for (const language of EXECUTION_LANGUAGES) {
      if (JUDGE0_PINNED_LANGUAGE_IDS[language] !== undefined) continue;
      const resolved = selectJudge0Language(INSTANCE, language);
      expect(resolved, language).not.toBeNull();
      expect(normalise(resolved!.name), `${language} label`).toContain(
        normalise(EXECUTION_RUNTIME_LABELS[language]),
      );
    }
  });
});

/**
 * The payload contract, against a stubbed instance.
 *
 * This is the bug that mattered most: with `base64_encoded=false`, retrieving
 * a submission whose compiler output contains typographic quotes — which every
 * GCC warning has — returned HTTP 400, and the user was told their code had
 * not run when it had.
 */
describe('F3.1 · base64 payload contract', () => {
  afterEach(() => vi.unstubAllGlobals());

  const b64 = (value: string) => Buffer.from(value, 'utf8').toString('base64');

  /** Real GCC output: note the U+2018/U+2019 quotes around `main`. */
  const GCC_WARNING = 'main.c: In function ‘main’:\nmain.c:2:9: warning: unused variable ‘x’\n';

  function stubInstance() {
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push(url);
        const json = (body: unknown) =>
          new Response(JSON.stringify(body), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });

        if (url.includes('/languages')) return json(INSTANCE);
        if (url.includes('/submissions/')) {
          return json({
            status: { id: 3 },
            time: '0.01',
            memory: 1024,
            stdout: b64('hello\n'),
            stderr: null,
            compile_output: b64(GCC_WARNING),
          });
        }
        // the POST
        return json({ token: 'tok-1', _body: init?.body });
      }),
    );
    return calls;
  }

  it('submits and retrieves with base64_encoded=true', async () => {
    const calls = stubInstance();
    const provider = new Judge0Provider({ baseUrl: 'https://judge.test', pollIntervalMs: 1 });

    await provider.execute({
      language: 'c11',
      source: 'int main(){}',
      stdin: null,
      expectedOutput: null,
    });

    const submit = calls.find((url) => url.includes('/submissions?'));
    const poll = calls.find((url) => url.includes('/submissions/'));
    expect(submit).toContain('base64_encoded=true');
    expect(poll).toContain('base64_encoded=true');
    // The old, broken form must not reappear.
    expect(submit).not.toContain('base64_encoded=false');
    expect(poll).not.toContain('base64_encoded=false');
  });

  it('base64-encodes the source and stdin it sends', async () => {
    stubInstance();
    const provider = new Judge0Provider({ baseUrl: 'https://judge.test', pollIntervalMs: 1 });
    await provider.execute({
      language: 'c11',
      source: 'SOURCE',
      stdin: 'STDIN',
      expectedOutput: null,
    });

    const call = vi
      .mocked(fetch)
      .mock.calls.find(([url]) => String(url).includes('/submissions?'));
    const body = JSON.parse(String((call?.[1] as RequestInit).body)) as Record<string, unknown>;
    expect(body.source_code).toBe(b64('SOURCE'));
    expect(body.stdin).toBe(b64('STDIN'));
    expect(body.expected_output).toBeNull();
    // This provider was built WITHOUT languageIds, so it falls back to the
    // heuristic and picks Clang 7 (id 75) — the behaviour the pin corrects.
    expect(body.language_id).toBe(75);
  });

  it('decodes output, including the GCC quotes that used to cause a 400', async () => {
    stubInstance();
    const provider = new Judge0Provider({ baseUrl: 'https://judge.test', pollIntervalMs: 1 });
    const result = await provider.execute({
      language: 'c11',
      source: 'int main(){}',
      stdin: null,
      expectedOutput: null,
    });

    expect(result.stdout).toBe('hello\n');
    expect(result.compileOutput).toBe(GCC_WARNING);
    expect(result.compileOutput).toContain('‘main’');
    // Not left as base64.
    expect(result.compileOutput).not.toBe(b64(GCC_WARNING));
  });

  it('reports the real runtime name for a PINNED id, not our own config', async () => {
    stubInstance();
    const provider = new Judge0Provider({
      baseUrl: 'https://judge.test',
      pollIntervalMs: 1,
      languageIds: JUDGE0_PINNED_LANGUAGE_IDS,
    });

    const result = await provider.execute({
      language: 'c11',
      source: 'int main(){}',
      stdin: null,
      expectedOutput: null,
    });

    // F4.1 stores this as the evidence a problem was validated against a known
    // runtime. "c11 (configured id 50)" would be evidence of nothing.
    expect(result.compilerRuntimeVersion).toBe('C (GCC 9.2.0)');
    expect(result.compilerRuntimeVersion).not.toContain('configured id');
  });

  it('falls back to a synthetic name only when the instance omits the pinned id', async () => {
    stubInstance();
    const provider = new Judge0Provider({
      baseUrl: 'https://judge.test',
      pollIntervalMs: 1,
      languageIds: { c11: 9999 },
    });

    const result = await provider.execute({
      language: 'c11',
      source: 'int main(){}',
      stdin: null,
      expectedOutput: null,
    });
    expect(result.compilerRuntimeVersion).toBe('c11 (configured id 9999)');
  });
});
