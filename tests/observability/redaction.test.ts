/**
 * F4.6 · no PII in the logs, and a request id that survives three layers.
 *
 * Two criteria:
 *
 *   · "grep the log output for an email address and a phone number: zero hits"
 *   · "a single request_id is traceable from the HTTP entry through a service
 *     call into a background job"
 *
 * The first is the one that goes vacuous easily. "We found no emails" passes
 * against a logger that writes nothing, against a test that logs nothing, and
 * against a grep with a typo in it. So every assertion here runs against a
 * control: the same check, on the same shape of data, WITHOUT redaction — and
 * it must find what the real one did not.
 */
import { describe, expect, it, vi } from 'vitest';
import { REDACTED, redact, redactString } from '@/server/lib/observability/redact';
import { formatLine, log } from '@/server/lib/observability/logger';
import {
  currentRequestId,
  resolveRequestId,
  setContextUser,
  withRequestContext,
} from '@/server/lib/observability/trace';

const EMAIL = 'vikram.yadav@example.com';
const PHONE = '+91 98765 43210';

/**
 * The grep the criterion describes, run over real output.
 *
 * The line's own `timestamp` is excluded, because an ISO timestamp is eight
 * digits joined by dashes and matches any phone pattern loose enough to be
 * useful. Nobody auditing a log greps their own timestamps — but the FIRST
 * version of this test did, and it failed every assertion for that reason,
 * which is how the redactor's own too-loose pattern was found.
 */
function pii(text: string): string[] {
  const withoutTimestamp = text.replace(/"timestamp":"[^"]*"/, '');

  const found: string[] = [];
  if (/[\w.+-]+@[\w-]+\.[\w.-]+/.test(withoutTimestamp)) found.push('email');
  if (/\+?\d[\d\s().-]{7,}\d/.test(withoutTimestamp)) found.push('phone');
  return found;
}

describe('F4.6 · THE GREP FINDS NOTHING', () => {
  it('an email in a field is gone', () => {
    expect(pii(formatLine('info', 'auth.signin', { email: EMAIL }))).toEqual([]);
  });

  it('an email buried in a free-text message is gone', () => {
    // The case a key-name check alone would miss.
    const line = formatLine('error', 'auth.failed', {
      message: `no account for ${EMAIL}`,
    });
    expect(pii(line)).toEqual([]);
  });

  it('a phone number is gone, however it is written', () => {
    for (const value of [PHONE, '9876543210', '+91-98765-43210', '(98765) 43210']) {
      expect(pii(formatLine('info', 'otp.sent', { to: value }))).toEqual([]);
    }
  });

  it('an email inside an Error message is gone', () => {
    const line = formatLine('error', 'x', { error: new Error(`bad login for ${EMAIL}`) });
    expect(pii(line)).toEqual([]);
  });

  it('a nested object is redacted all the way down', () => {
    const line = formatLine('info', 'x', {
      request: { body: { user: { email: EMAIL, phone: PHONE } } },
    });
    expect(pii(line)).toEqual([]);
  });

  it('POSITIVE CONTROL · the same grep FINDS them without redaction', () => {
    /*
     * Without this every assertion above is satisfied by a logger that writes
     * nothing — the vacuous pass this project has been caught by twice.
     */
    const unredacted = JSON.stringify({ email: EMAIL, phone: PHONE });

    expect(pii(unredacted).sort()).toEqual(['email', 'phone']);
  });

  it('POSITIVE CONTROL · the lines being checked are not empty', () => {
    // And that they carry the event, so the check is reading real output.
    const line = formatLine('info', 'auth.signin', { email: EMAIL });

    expect(line.length).toBeGreaterThan(50);
    expect(line).toContain('auth.signin');
    expect(line).toContain(REDACTED);
  });
});

describe('F4.6 · what redaction keeps', () => {
  it('KEEPS user_id, because a log with no identity cannot be followed', () => {
    const id = '9bf6e8f9-140b-4658-8c2e-6441a2bd22da';
    const line = withRequestContext({ requestId: 'req-1', userId: id }, () =>
      formatLine('info', 'x'),
    );

    expect(line).toContain(id);
  });

  it('keeps ordinary values', () => {
    const line = formatLine('info', 'execution.finished', {
      durationMs: 120,
      verdict: 'accepted',
    });

    expect(line).toContain('accepted');
    expect(line).toContain('120');
  });

  it('redacts by key even when the value looks harmless', () => {
    // `{ token: 'abc123' }` has no email shape and must still go.
    expect(redact({ token: 'abc123' })).toEqual({ token: REDACTED });
    expect(redact({ authorization: 'Bearer x' })).toEqual({ authorization: REDACTED });
  });

  it('survives a cycle rather than hanging the process', () => {
    const cyclic: Record<string, unknown> = { name: 'x' };
    cyclic['self'] = cyclic;

    // A logger that can hang the process is worse than no logger.
    expect(() => redact(cyclic)).not.toThrow();
  });

  it('over-redacts a long number, and that is the right trade', () => {
    // A 10-digit order id is redacted too. An over-redacted log is harder to
    // read; an under-redacted one is a breach.
    expect(redactString('order 1234567890')).toContain(REDACTED);
  });

  it('LEAVES A DATE ALONE, which the first version did not', () => {
    /*
     * `2026-08-28` is eight digits joined by dashes. A pattern loose enough to
     * catch a phone number catches it too, and a redactor that replaces the
     * date on every log line is broken rather than cautious. Nine digits is
     * what separates them.
     */
    expect(redactString('on 2026-08-28 the job ran')).toBe('on 2026-08-28 the job ran');
    expect(redactString('at 2026-08-28T20:47:15.878Z')).toContain('2026-08-28');
  });
});

describe('F4.6 · ONE REQUEST ID ACROSS THREE LAYERS', () => {
  it('follows an HTTP entry into a service and into a job', async () => {
    const lines: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((line) => {
      lines.push(String(line));
    });

    /** Layer 3 — what the in-process runner does inside `setImmediate`. */
    const job = async () => {
      await new Promise((resolve) => setImmediate(resolve));
      log.info('job.ran');
    };

    /** Layer 2 — a service call. */
    const service = async () => {
      log.info('service.called');
      await job();
    };

    /** Layer 1 — the route handler. */
    await withRequestContext({ requestId: 'req-abc12345', userId: null }, async () => {
      log.info('http.received');
      await service();
    });

    spy.mockRestore();

    expect(lines).toHaveLength(3);
    for (const line of lines) {
      expect(JSON.parse(line).requestId).toBe('req-abc12345');
    }

    // And the three layers really are distinct events, not one line thrice.
    expect(lines.map((line) => JSON.parse(line).event)).toEqual([
      'http.received',
      'service.called',
      'job.ran',
    ]);
  });

  it('is null outside a request, rather than throwing', () => {
    // Scripts and sweeps run outside any request. That is normal, not an error.
    expect(currentRequestId()).toBeNull();
    expect(JSON.parse(formatLine('info', 'x')).requestId).toBeNull();
  });

  it('picks up the user once authentication has happened', () => {
    // A request knows its id before it knows who is making it.
    const lines = withRequestContext({ requestId: 'req-1', userId: null }, () => {
      const before = formatLine('info', 'http.received');
      setContextUser('user-42');
      const after = formatLine('info', 'http.authenticated');
      return [before, after];
    });

    expect(JSON.parse(lines[0]!).userId).toBeNull();
    expect(JSON.parse(lines[1]!).userId).toBe('user-42');
    // Same request throughout — that is what makes the pair followable.
    expect(JSON.parse(lines[0]!).requestId).toBe(JSON.parse(lines[1]!).requestId);
  });
});

describe('F4.6 · the incoming header is untrusted input', () => {
  it('accepts a sane upstream id, so a trace can start before us', () => {
    expect(resolveRequestId('abc12345-def')).toBe('abc12345-def');
  });

  it('CAPS AND STRIPS IT', () => {
    /*
     * This value lands in every log line for the request. Unbounded, it is a
     * way to write megabytes into a log file with one request.
     */
    const long = resolveRequestId('x'.repeat(500));
    expect(long.length).toBeLessThanOrEqual(64);

    expect(resolveRequestId('abc12345"\n{evil}')).not.toMatch(/[{}"\n]/);
  });

  it('generates one when the header is missing or too short to be real', () => {
    expect(resolveRequestId(null)).toMatch(/^[0-9a-f-]{36}$/);
    expect(resolveRequestId('x')).toMatch(/^[0-9a-f-]{36}$/);
  });
});
