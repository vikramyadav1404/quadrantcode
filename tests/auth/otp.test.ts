/**
 * F0.3 acceptance criteria for the phone OTP flow, against a real Postgres.
 *
 * The clock is injected rather than mocked globally, so an expiry test does
 * not have to wait ten minutes and does not depend on fake-timer plumbing
 * leaking between suites.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { users, verificationMethods } from '@/server/db/schema';
import {
  OTP_MAX_REQUESTS_PER_HOUR,
  OTP_MAX_VERIFY_ATTEMPTS,
  codeMatches,
  generateOtpCode,
  hashOtpCode,
  isValidE164,
  requestPhoneOtp,
  verifyPhoneOtp,
} from '@/server/services/auth/otp';
import type { OtpProvider } from '@/server/services/otp/provider';
import { redactPhone } from '@/server/services/otp/provider';
import {
  type TestContext,
  createUser,
  hasTestDatabase,
  setupTestDb,
  truncateAll,
} from '../helpers/db';

const suite = hasTestDatabase ? describe : describe.skip;
const SECRET = 'test-pepper';
const PHONE = '+919876543210';

/** Captures delivered codes so tests can submit the real one. */
function recordingProvider() {
  const sent: Array<{ phoneNumber: string; code: string }> = [];
  const provider: OtpProvider = {
    name: 'recording',
    send(phoneNumber, code) {
      sent.push({ phoneNumber, code });
      return Promise.resolve({ ok: true as const, providerMessageId: `test-${sent.length}` });
    },
  };
  return { provider, sent, last: () => sent.at(-1)?.code ?? '' };
}

describe('F0.3 · OTP primitives (no database)', () => {
  it('generates a uniform 6-digit code, zero-padded', () => {
    const codes = Array.from({ length: 500 }, () => generateOtpCode());
    for (const code of codes) expect(code).toMatch(/^\d{6}$/);
    // A padding bug shows up as codes never starting with 0.
    expect(codes.some((code) => code.startsWith('0'))).toBe(true);
  });

  it('never stores the code in plaintext and compares in constant time', () => {
    const hash = hashOtpCode('123456', SECRET);
    expect(hash).not.toContain('123456');
    expect(hash).toHaveLength(64);

    expect(codeMatches(hashOtpCode('123456', SECRET), hash)).toBe(true);
    expect(codeMatches(hashOtpCode('123457', SECRET), hash)).toBe(false);
    // A different pepper must not validate — the hash is peppered, not plain.
    expect(codeMatches(hashOtpCode('123456', 'other-pepper'), hash)).toBe(false);
  });

  it('rejects a malformed comparison instead of throwing', () => {
    expect(codeMatches('', hashOtpCode('123456', SECRET))).toBe(false);
    expect(codeMatches('abcd', hashOtpCode('123456', SECRET))).toBe(false);
  });

  it('validates E.164', () => {
    expect(isValidE164('+919876543210')).toBe(true);
    expect(isValidE164('9876543210')).toBe(false);
    expect(isValidE164('+0123456789')).toBe(false);
    expect(isValidE164('+91 98765 43210')).toBe(false);
  });

  it('redacts the phone number for logs', () => {
    expect(redactPhone('+919876543210')).toBe('+91******3210');
    expect(redactPhone('+919876543210')).not.toContain('98765');
    expect(redactPhone('12345')).toBe('*****');
  });
});

suite('F0.3 · OTP flow', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await setupTestDb();
  }, 60_000);

  afterAll(async () => {
    await ctx?.close();
  });

  beforeEach(async () => {
    await truncateAll(ctx.sql);
  });

  const deps = (provider: OtpProvider, now?: () => Date) => ({
    db: ctx.db,
    provider,
    secret: SECRET,
    ...(now ? { now } : {}),
  });

  it('issues a code and verifies it, setting phone_verified_at', async () => {
    const user = await createUser(ctx.db);
    const { provider, last } = recordingProvider();

    expect(await requestPhoneOtp(deps(provider), user.id, PHONE)).toEqual({ ok: true });
    expect(await verifyPhoneOtp(deps(provider), user.id, last())).toEqual({ ok: true });

    const [updated] = await ctx.db.select().from(users).where(eq(users.id, user.id));
    expect(updated?.phoneNumber).toBe(PHONE);
    expect(updated?.phoneVerifiedAt).not.toBeNull();
    expect(updated?.verificationLevel).toBe(1);
  });

  it('blocks the 4th request within an hour for one number', async () => {
    const user = await createUser(ctx.db);
    const { provider, sent } = recordingProvider();

    for (let i = 0; i < OTP_MAX_REQUESTS_PER_HOUR; i += 1) {
      expect(await requestPhoneOtp(deps(provider), user.id, PHONE)).toEqual({ ok: true });
    }

    expect(await requestPhoneOtp(deps(provider), user.id, PHONE)).toEqual({
      ok: false,
      reason: 'rate_limited',
    });
    // The blocked request must not have sent an SMS.
    expect(sent).toHaveLength(OTP_MAX_REQUESTS_PER_HOUR);
  });

  it('allows a request again once the hour window rolls over', async () => {
    const user = await createUser(ctx.db);
    const { provider } = recordingProvider();
    const base = Date.now();

    for (let i = 0; i < OTP_MAX_REQUESTS_PER_HOUR; i += 1) {
      await requestPhoneOtp(
        deps(provider, () => new Date(base)),
        user.id,
        PHONE,
      );
    }

    const later = () => new Date(base + 61 * 60 * 1000);
    expect(await requestPhoneOtp(deps(provider, later), user.id, PHONE)).toEqual({ ok: true });
  });

  it('rejects the 6th wrong attempt and burns the code', async () => {
    const user = await createUser(ctx.db);
    const { provider, last } = recordingProvider();
    await requestPhoneOtp(deps(provider), user.id, PHONE);

    const wrong = last() === '000000' ? '111111' : '000000';

    for (let attempt = 1; attempt < OTP_MAX_VERIFY_ATTEMPTS; attempt += 1) {
      expect(await verifyPhoneOtp(deps(provider), user.id, wrong)).toEqual({
        ok: false,
        reason: 'mismatch',
      });
    }

    // 5th wrong guess burns it.
    expect(await verifyPhoneOtp(deps(provider), user.id, wrong)).toEqual({
      ok: false,
      reason: 'locked',
    });

    // 6th submission finds no active code — even with the CORRECT digits.
    expect(await verifyPhoneOtp(deps(provider), user.id, last())).toEqual({
      ok: false,
      reason: 'no_active_code',
    });

    const [record] = await ctx.db
      .select()
      .from(verificationMethods)
      .where(eq(verificationMethods.userId, user.id));
    expect(record?.consumedAt).not.toBeNull();
  });

  it('fails an expired code even when the digits are correct', async () => {
    const user = await createUser(ctx.db);
    const { provider, last } = recordingProvider();
    const issuedAt = Date.now();

    await requestPhoneOtp(
      deps(provider, () => new Date(issuedAt)),
      user.id,
      PHONE,
    );

    const elevenMinutesLater = () => new Date(issuedAt + 11 * 60 * 1000);
    expect(await verifyPhoneOtp(deps(provider, elevenMinutesLater), user.id, last())).toEqual({
      ok: false,
      reason: 'expired',
    });

    const [updated] = await ctx.db.select().from(users).where(eq(users.id, user.id));
    expect(updated?.phoneVerifiedAt).toBeNull();
  });

  it('rejects a phone already bound to another active account', async () => {
    const owner = await createUser(ctx.db, { email: 'owner@example.com' });
    const intruder = await createUser(ctx.db, { email: 'intruder@example.com' });
    const { provider, last, sent } = recordingProvider();

    await requestPhoneOtp(deps(provider), owner.id, PHONE);
    await verifyPhoneOtp(deps(provider), owner.id, last());

    const before = sent.length;
    expect(await requestPhoneOtp(deps(provider), intruder.id, PHONE)).toEqual({
      ok: false,
      reason: 'phone_taken',
    });
    // Rejected before any code was generated or sent.
    expect(sent).toHaveLength(before);
  });

  it('lets the SAME user re-verify their own number', async () => {
    const user = await createUser(ctx.db);
    const { provider, last } = recordingProvider();

    await requestPhoneOtp(deps(provider), user.id, PHONE);
    await verifyPhoneOtp(deps(provider), user.id, last());

    expect(await requestPhoneOtp(deps(provider), user.id, PHONE)).toEqual({ ok: true });
  });

  it('supersedes an outstanding code so only the newest one works', async () => {
    const user = await createUser(ctx.db);
    const { provider, sent } = recordingProvider();

    await requestPhoneOtp(deps(provider), user.id, PHONE);
    const firstCode = sent[0]!.code;
    await requestPhoneOtp(deps(provider), user.id, PHONE);
    const secondCode = sent[1]!.code;

    if (firstCode !== secondCode) {
      expect(await verifyPhoneOtp(deps(provider), user.id, firstCode)).toEqual({
        ok: false,
        reason: 'mismatch',
      });
    }
    expect(await verifyPhoneOtp(deps(provider), user.id, secondCode)).toEqual({ ok: true });
  });

  it('rejects a non-E.164 number without touching the database', async () => {
    const user = await createUser(ctx.db);
    const { provider, sent } = recordingProvider();

    expect(await requestPhoneOtp(deps(provider), user.id, '9876543210')).toEqual({
      ok: false,
      reason: 'invalid_phone',
    });
    expect(sent).toHaveLength(0);

    const rows = await ctx.db.select().from(verificationMethods);
    expect(rows).toHaveLength(0);
  });

  it('does not verify when delivery failed', async () => {
    const user = await createUser(ctx.db);
    const failing: OtpProvider = {
      name: 'failing',
      send: () => Promise.resolve({ ok: false as const, error: 'boom', retryable: true }),
    };

    expect(await requestPhoneOtp(deps(failing), user.id, PHONE)).toEqual({
      ok: false,
      reason: 'delivery_failed',
    });
  });
});
