/**
 * POST /api/auth/phone/request — send a sign-in code to a phone number.
 *
 * ## This one is deliberately not behind `getCurrentUser`
 *
 * Every other OTP route in this codebase starts with "sign in first". This is
 * the sign-in itself, so it cannot. That single difference is what makes the
 * rest of this file careful: an unauthenticated endpoint that takes a phone
 * number and behaves differently depending on whether it is registered is a
 * phone-number oracle, and the number is the user's real one.
 *
 * `startPhoneSignIn` returns `{ sent: true }` for an unknown number, a rate-
 * limited one, and a successful send alike. This route does not add any
 * distinction back:
 *
 *   · the same 200 body for all three
 *   · the 429 comes from a limiter keyed on the SUBMITTED number, which is not
 *     looked up first — so a made-up number is throttled on the same schedule
 *     as a real one, and the status code says nothing about existence
 *   · an invalid number IS reported, because that is a claim about the string
 *     the caller typed, not about who has an account. Refusing to say it makes
 *     the form unusable for a typo
 *
 * ## What is NOT hidden, stated rather than glossed
 *
 * Timing. A registered number does a lookup, writes a code row and calls the
 * SMS provider; an unregistered one stops after the lookup. That difference is
 * measurable. Closing it means sending to a black hole or padding to a fixed
 * budget, and neither is honest to build without measuring first. It is
 * recorded here as accepted, and belongs with F4.8's accepted-risk list rather
 * than being described as solved.
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { assertFeatureEnabled } from '@/lib/flags';
import { getDb } from '@/server/db';
import { getAuthSecret, getServerEnv } from '@/server/env';
import { clientIp } from '@/server/lib/client-ip';
import { RATE_LIMITS, checkAll, createRateLimiter } from '@/server/lib/ratelimit';
import { startPhoneSignIn } from '@/server/services/auth/phone-signin';
import { resolveOtpProvider } from '@/server/services/otp';

const RequestSchema = z.object({
  phoneNumber: z.string().min(8).max(20),
});

/** C7: the response is validated on the way out too. */
const ResponseSchema = z.object({
  ok: z.boolean(),
  message: z.string(),
});

/**
 * The one message a successful request can produce.
 *
 * Phrased as a conditional on purpose — "if that number can sign in" is true
 * whether or not it can, and it is the sentence a user needs either way.
 */
const SENT_MESSAGE = 'If that number can sign in, a code is on its way.';

export async function POST(request: Request): Promise<NextResponse> {
  assertFeatureEnabled('FEATURE_PHONE_OTP');

  const parsed = RequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      ResponseSchema.parse({ ok: false, message: 'Enter a valid phone number.' }),
      { status: 400 },
    );
  }

  const env = getServerEnv();

  /*
   * Both limiters key on what was submitted — the number and the caller's IP.
   * Neither consults the database, which is what keeps a 429 free of meaning.
   *
   * The same buckets as `/api/otp/request`, deliberately: one number should not
   * get three codes from settings and three more from the login page.
   */
  const gate = await checkAll([
    {
      limiter: createRateLimiter(RATE_LIMITS.otpRequestPerPhone, env),
      key: parsed.data.phoneNumber,
    },
    { limiter: createRateLimiter(RATE_LIMITS.otpRequestPerIp, env), key: clientIp(request) },
  ]);

  if (!gate.allowed) {
    return NextResponse.json(
      ResponseSchema.parse({
        ok: false,
        message: `Too many requests. Try again after ${gate.resetAt.toISOString()}.`,
      }),
      {
        status: 429,
        headers: {
          'Retry-After': String(
            Math.max(1, Math.ceil((gate.resetAt.getTime() - Date.now()) / 1000)),
          ),
        },
      },
    );
  }

  const outcome = await startPhoneSignIn(
    { db: getDb(), provider: resolveOtpProvider(env), secret: getAuthSecret(env) },
    parsed.data.phoneNumber,
  );

  if (!outcome.sent) {
    // `invalid_phone` is the only reachable branch, and it is about the string.
    return NextResponse.json(
      ResponseSchema.parse({ ok: false, message: 'Enter a valid phone number.' }),
      { status: 400 },
    );
  }

  return NextResponse.json(ResponseSchema.parse({ ok: true, message: SENT_MESSAGE }), {
    status: 200,
  });
}
