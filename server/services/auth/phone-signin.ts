/**
 * Signing in with a phone number you have already verified.
 *
 * ## This does NOT create accounts, and that is a schema fact not a choice
 *
 * `users.email` is `NOT NULL` (F0.2), and `verification_level` is documented as
 * `0 = email only, 1 = email + phone`. The identity model is: **email is who
 * you are, phone is something you added.** A phone-only account is not
 * representable without making email nullable, which would touch the adapter,
 * every read that assumes an address, and the magic-link flow itself.
 *
 * So this is sign-IN only. New users still start with an email link; once they
 * verify a phone at `/settings/phone`, they can use it to get back in — which
 * is genuinely useful when email delivery is slow or blocked.
 *
 * ## The response never says whether a phone exists
 *
 * A "no account for that number" reply turns this endpoint into a phone-number
 * oracle: try numbers, learn who has an account. Every path below returns the
 * same shape, and an OTP is only actually sent when the number resolves to a
 * verified account. That is the IDOR rule from F4.8, applied before login
 * rather than after it.
 *
 * ## It reuses the tested OTP service rather than reimplementing it
 *
 * `requestPhoneOtp` and `verifyPhoneOtp` carry the rolling-hour cap, the
 * five-attempt lockout and the hashed codes, all tested in F0.3. They take a
 * `userId` because they were built for a signed-in user verifying a number;
 * resolving the number to its owner first is what lets this flow use them
 * unchanged.
 */
import { and, eq, isNotNull, isNull } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';
import type { Database } from '@/server/db';
import { authSessions, users } from '@/server/db/schema';
import { log } from '@/server/lib/observability';
import { isValidE164, requestPhoneOtp, verifyPhoneOtp } from './otp';
import type { OtpDeps } from './otp';

/** How long a session created this way lasts. Same as a magic-link session. */
const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

/**
 * Deliberately indistinguishable outcomes.
 *
 * `sent: true` is returned for an unknown number as well as a known one. The
 * caller shows the same screen either way.
 */
export type PhoneSignInRequest = { sent: true } | { sent: false; reason: 'invalid_phone' };

export type PhoneSignInResult =
  { ok: true; sessionToken: string; expires: Date } | { ok: false; message: string };

/** The owner of a VERIFIED phone number, or null. */
async function verifiedOwner(db: Database, phoneNumber: string): Promise<string | null> {
  const [row] = await db
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        eq(users.phoneNumber, phoneNumber),
        // Unverified is not signed-in-able: someone could have typed a number
        // they do not own into their settings and never confirmed it.
        isNotNull(users.phoneVerifiedAt),
        isNull(users.deletedAt),
      ),
    )
    .limit(1);

  return row?.id ?? null;
}

/**
 * Start a phone sign-in.
 *
 * An invalid number is the one thing worth saying out loud — it is a typo, not
 * a fact about who has an account, and refusing to say so makes the form
 * unusable.
 */
export async function startPhoneSignIn(
  deps: OtpDeps,
  phoneNumber: string,
): Promise<PhoneSignInRequest> {
  if (!isValidE164(phoneNumber)) return { sent: false, reason: 'invalid_phone' };

  const userId = await verifiedOwner(deps.db as Database, phoneNumber);

  if (!userId) {
    /*
     * No account, or an unverified number. Say nothing — and log it, so a
     * sweep of many numbers is visible to whoever reads the logs even though
     * it is invisible to the caller.
     */
    log.info('auth.phone_signin_unknown_number');
    return { sent: true };
  }

  const outcome = await requestPhoneOtp(deps, userId, phoneNumber);

  if (!outcome.ok) {
    /*
     * Rate limited, or the number is attached elsewhere. Still `sent: true`:
     * "you are being rate limited" is itself a statement that the number
     * exists, which is the thing this endpoint must not reveal.
     */
    log.info('auth.phone_signin_refused', { reason: outcome.reason });
    return { sent: true };
  }

  return { sent: true };
}

/**
 * Finish a phone sign-in and create a session.
 *
 * The session row is written the same way the Auth.js adapter writes one, so a
 * session created here is revocable, expires on the same schedule, and is
 * indistinguishable downstream from one created by a magic link. Anything less
 * would mean "log out all devices" quietly missing these.
 */
export async function completePhoneSignIn(
  deps: OtpDeps,
  phoneNumber: string,
  code: string,
): Promise<PhoneSignInResult> {
  const now = deps.now?.() ?? new Date();
  const db = deps.db as Database;

  const generic = { ok: false as const, message: 'That code is not valid.' };

  if (!isValidE164(phoneNumber)) return generic;

  const userId = await verifiedOwner(db, phoneNumber);
  if (!userId) return generic;

  const outcome = await verifyPhoneOtp(deps, userId, code);

  if (!outcome.ok) {
    /*
     * One message for every failure — wrong code, expired code, no code, locked
     * out. The distinctions are useful to an attacker and useless to the user,
     * who can only do one thing about any of them: ask for another code.
     */
    log.warn('auth.phone_signin_failed', { reason: outcome.reason });
    return generic;
  }

  const sessionToken = randomBytes(32).toString('hex');
  const expires = new Date(now.getTime() + SESSION_MAX_AGE_SECONDS * 1000);

  await db.insert(authSessions).values({ sessionToken, userId, expires });

  log.info('auth.phone_signin_succeeded');

  return { ok: true, sessionToken, expires };
}
