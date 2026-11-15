/**
 * How long the Judge0 client waits for one submission.
 *
 * Reference validation runs five languages at once, so on a small instance a
 * submission can queue behind the other four for longer than the default wait.
 * The admin action asks for a longer wait; everything else keeps the default.
 * Judge0 is replaced by a fetch stub that reports "in queue" for a set time.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  resolveProvider,
  VALIDATION_POLL_TIMEOUT_MS,
} from '@/server/services/execution/provider';
import { ProviderUnavailableError } from '@/server/services/execution';

const ENV = {
  NODE_ENV: 'production',
  EXECUTION_BACKEND: 'judge0',
  JUDGE0_URL: 'https://judge0.test',
  JUDGE0_API_KEY: 'test-token',
} as const;

const REQUEST = {
  language: 'python3',
  source: 'print(1)',
  stdin: '',
  expectedOutput: null,
  limits: { cpuSeconds: 2, wallSeconds: 5, memoryKb: 256_000 },
} as const;

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });

/** A Judge0 that keeps a submission "in queue" until `finishesAfterMs` has passed. */
function stubJudge0(finishesAfterMs: number) {
  const startedAt = Date.now();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/languages')) return json([{ id: 71, name: 'Python (3.8.1)' }]);
      if (url.includes('/submissions/')) {
        const finished = Date.now() - startedAt >= finishesAfterMs;
        return json(
          finished
            ? { status: { id: 3 }, stdout: 'MQo=', time: '0.01', memory: 3_000 }
            : { status: { id: 1 } },
        );
      }
      return json({ token: 'abc' });
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Judge0 poll timeout', () => {
  it('gives up, without a verdict, when the submission outlasts the wait', async () => {
    stubJudge0(2_000);
    const provider = resolveProvider(ENV, { pollTimeoutMs: 300 });

    await expect(provider.execute(REQUEST)).rejects.toBeInstanceOf(ProviderUnavailableError);
  });

  it('returns the result when the wait is long enough for the same submission', async () => {
    stubJudge0(600);
    const provider = resolveProvider(ENV, { pollTimeoutMs: 5_000 });

    const result = await provider.execute(REQUEST);

    expect(result.verdict).toBe('accepted');
    expect(result.stdout?.trim()).toBe('1');
  });

  it('gives validation three times the default wait', () => {
    // The default in judge0.ts is 15s, sized for a user's run inside a 60s
    // function. Validation runs inside 300s and competes with itself.
    expect(VALIDATION_POLL_TIMEOUT_MS).toBe(45_000);
  });
});
