/**
 * Phone OTP business rules (F0.3).
 *
 * Every limit here is enforced against the DATABASE, not only against Redis.
 * Redis rate limiting (server/lib/ratelimit.ts) sits in front of the route to
 * absorb floods cheaply, but a Redis outage or a flushed key must not hand an
 * attacker unlimited attempts — so the durable rules live here.
 *
 * Codes are hashed with HMAC-SHA256 keyed by AUTH_SECRET. A plain digest would
 * be trivially reversible for a 6-digit code if the database leaked; the
 * server-side pepper means an attacker needs the application secret too.
 * Comparison is constant-time.
 */
import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import { and, count, desc, eq, gt, isNull, sql } from 'drizzle-orm';
import type { Database } from '@/server/db';
import { users, verificationMethods } from '@/server/db/schema';
import type { OtpProvider } from '@/server/services/otp/provider';
import { redactPhone } from '@/server/services/otp/provider';

// ── Documented limits ───────────────────────────────────────────────────────
export const OTP_CODE_LENGTH = 6;
export const OTP_TTL_MINUTES = 10;
/** Wrong guesses tolerated before the code is burned. The 6th is rejected. */
export const OTP_MAX_VERIFY_ATTEMPTS = 5;
/** Codes a single phone number may request per rolling hour. The 4th is blocked. */
export const OTP_MAX_REQUESTS_PER_HOUR = 3;

export type OtpRequestOutcome =
  | { ok: true }
  | { ok: false; reason: 'rate_limited' | 'phone_taken' | 'delivery_failed' | 'invalid_phone' };

export type OtpVerifyOutcome =
  | { ok: true }
  | { ok: false; reason: 'no_active_code' | 'expired' | 'locked' | 'mismatch' | 'phone_taken' };

/** E.164: a leading + and 8–15 digits, first digit non-zero. */
const E164 = /^\+[1-9]\d{7,14}$/;

export function isValidE164(phoneNumber: string): boolean {
  return E164.test(phoneNumber);
}

export function hashOtpCode(code: string, secret: string): string {
  return createHmac('sha256', secret).update(code).digest('hex');
}

/** Constant-time compare of two hex digests of equal length. */
export function codeMatches(candidateHash: string, storedHash: string): boolean {
  const a = Buffer.from(candidateHash, 'hex');
  const b = Buffer.from(storedHash, 'hex');
  if (a.length !== b.length || a.length === 0) return false;
  return timingSafeEqual(a, b);
}

/** Cryptographically uniform 6-digit code. `Math.random` is not acceptable here. */
export function generateOtpCode(length: number = OTP_CODE_LENGTH): string {
  const max = 10 ** length;
  return String(randomInt(0, max)).padStart(length, '0');
}

export type OtpDeps = {
  db: Database;
  provider: OtpProvider;
  secret: string;
  /** Injectable so expiry can be tested without waiting ten minutes. */
  now?: () => Date;
};

function logOtpEvent(
  event: string,
  phoneNumber: string,
  extra: Record<string, unknown> = {},
): void {
  console.warn(
    JSON.stringify({
      event,
      phone: redactPhone(phoneNumber),
      ...extra,
      at: new Date().toISOString(),
    }),
  );
}

/**
 * Issues a code for `phoneNumber` on behalf of `userId`.
 *
 * Order matters: the "already bound elsewhere" check runs BEFORE the code is
 * created, so a taken number never consumes the requester's hourly quota and
 * never triggers an SMS.
 */
export async function requestPhoneOtp(
  deps: OtpDeps,
  userId: string,
  phoneNumber: string,
): Promise<OtpRequestOutcome> {
  const now = deps.now?.() ?? new Date();

  if (!isValidE164(phoneNumber)) return { ok: false, reason: 'invalid_phone' };

  // One phone number may be attached to exactly one active account, ever.
  const [existingOwner] = await deps.db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.phoneNumber, phoneNumber), isNull(users.deletedAt)))
    .limit(1);

  if (existingOwner && existingOwner.id !== userId) {
    logOtpEvent('otp.request_rejected_phone_taken', phoneNumber);
    return { ok: false, reason: 'phone_taken' };
  }

  // Rolling-hour cap, counted per phone number rather than per user so that
  // creating fresh accounts does not reset it.
  const windowStart = new Date(now.getTime() - 60 * 60 * 1000);
  const [requests] = await deps.db
    .select({ value: count() })
    .from(verificationMethods)
    .where(
      and(
        eq(verificationMethods.method, 'phone'),
        eq(verificationMethods.identifier, phoneNumber),
        gt(verificationMethods.createdAt, windowStart),
      ),
    );

  if ((requests?.value ?? 0) >= OTP_MAX_REQUESTS_PER_HOUR) {
    logOtpEvent('otp.request_rate_limited', phoneNumber, { window: '1h' });
    return { ok: false, reason: 'rate_limited' };
  }

  const code = generateOtpCode();
  const expiresAt = new Date(now.getTime() + OTP_TTL_MINUTES * 60 * 1000);

  // Supersede any outstanding code so only one is ever live per (user, method).
  await deps.db
    .update(verificationMethods)
    .set({ consumedAt: now })
    .where(
      and(
        eq(verificationMethods.userId, userId),
        eq(verificationMethods.method, 'phone'),
        isNull(verificationMethods.consumedAt),
      ),
    );

  await deps.db.insert(verificationMethods).values({
    userId,
    method: 'phone',
    identifier: phoneNumber,
    codeHash: hashOtpCode(code, deps.secret),
    expiresAt,
    createdAt: now,
  });

  const delivery = await deps.provider.send(phoneNumber, code);
  if (!delivery.ok) {
    logOtpEvent('otp.delivery_failed', phoneNumber, { retryable: delivery.retryable });
    return { ok: false, reason: 'delivery_failed' };
  }

  logOtpEvent('otp.requested', phoneNumber, { provider: deps.provider.name });
  return { ok: true };
}

/**
 * Verifies a submitted code.
 *
 * A wrong guess increments `attempts`; the code burns when attempts reach
 * OTP_MAX_VERIFY_ATTEMPTS, so the 6th submission finds no active code. An
 * expired code fails even when the digits are right — expiry is checked before
 * the digits, so a correct-but-late code cannot succeed.
 */
export async function verifyPhoneOtp(
  deps: OtpDeps,
  userId: string,
  code: string,
): Promise<OtpVerifyOutcome> {
  const now = deps.now?.() ?? new Date();

  const [record] = await deps.db
    .select()
    .from(verificationMethods)
    .where(
      and(
        eq(verificationMethods.userId, userId),
        eq(verificationMethods.method, 'phone'),
        isNull(verificationMethods.consumedAt),
      ),
    )
    .orderBy(desc(verificationMethods.createdAt))
    .limit(1);

  if (!record) return { ok: false, reason: 'no_active_code' };

  if (record.expiresAt.getTime() <= now.getTime()) {
    await deps.db
      .update(verificationMethods)
      .set({ consumedAt: now })
      .where(eq(verificationMethods.id, record.id));
    logOtpEvent('otp.verify_expired', record.identifier);
    return { ok: false, reason: 'expired' };
  }

  if (record.attempts >= OTP_MAX_VERIFY_ATTEMPTS) {
    await deps.db
      .update(verificationMethods)
      .set({ consumedAt: now })
      .where(eq(verificationMethods.id, record.id));
    logOtpEvent('otp.verify_locked', record.identifier, { attempts: record.attempts });
    return { ok: false, reason: 'locked' };
  }

  if (!codeMatches(hashOtpCode(code, deps.secret), record.codeHash)) {
    const attempts = record.attempts + 1;
    const burned = attempts >= OTP_MAX_VERIFY_ATTEMPTS;

    await deps.db
      .update(verificationMethods)
      .set({ attempts, consumedAt: burned ? now : null })
      .where(eq(verificationMethods.id, record.id));

    logOtpEvent(burned ? 'otp.verify_locked' : 'otp.verify_failed', record.identifier, {
      attempts,
    });
    return { ok: false, reason: burned ? 'locked' : 'mismatch' };
  }

  // Correct code. Claim the number, re-checking uniqueness inside the write —
  // another account could have bound it between request and verify.
  try {
    await deps.db.transaction(async (tx) => {
      await tx
        .update(verificationMethods)
        .set({ consumedAt: now })
        .where(eq(verificationMethods.id, record.id));

      await tx
        .update(users)
        .set({
          phoneNumber: record.identifier,
          phoneVerifiedAt: now,
          // verification_level is recomputed rather than incremented, so the
          // cached column can never drift from the derived value.
          verificationLevel: sql`greatest(${users.verificationLevel}, 1)`,
        })
        .where(eq(users.id, userId));
    });
  } catch {
    logOtpEvent('otp.verify_phone_taken', record.identifier);
    return { ok: false, reason: 'phone_taken' };
  }

  logOtpEvent('otp.verified', record.identifier);
  return { ok: true };
}

/**
 * Client-facing message for any failure.
 *
 * Security requirement: generic errors only. The reason codes above are for
 * logs and tests; the user is never told whether a number is registered,
 * whether a code existed, or whether they simply guessed wrong.
 */
export function genericOtpErrorMessage(): string {
  return "That didn't work. Request a new code and try again.";
}
