/**
 * POST /api/auth/phone/verify — exchange a code for a session.
 *
 * ## The session written here is a real one, not a parallel kind
 *
 * `completePhoneSignIn` inserts into `auth_sessions` exactly as the Auth.js
 * adapter does, and this route sets the same cookie under the same name using
 * `sessionCookie()` — the single definition Auth.js itself is configured with.
 *
 * That matters more than it looks. A second cookie name, or a session row the
 * adapter does not recognise, means "sign out everywhere" quietly misses these,
 * and the session cannot be revoked by the code that revokes the others. There
 * is one session table and one cookie; this is another way in, not another kind
 * of session.
 *
 * ## One message for every failure
 *
 * Wrong code, expired code, no code outstanding, locked out, number belongs to
 * nobody — all `That code is not valid.` The distinctions are useful to someone
 * guessing and useless to the person typing, who can only do one thing about
 * any of them: ask for another code.
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { assertFeatureEnabled } from '@/lib/flags';
import { getDb } from '@/server/db';
import { getAuthSecret, getServerEnv } from '@/server/env';
import { clientIp } from '@/server/lib/client-ip';
import { RATE_LIMITS, checkAll, createRateLimiter } from '@/server/lib/ratelimit';
import { sessionCookie } from '@/server/services/auth/config';
import { completePhoneSignIn } from '@/server/services/auth/phone-signin';
import { resolveOtpProvider } from '@/server/services/otp';

const VerifySchema = z.object({
  phoneNumber: z.string().min(8).max(20),
  code: z.string().regex(/^\d{6}$/),
});

const ResponseSchema = z.object({
  ok: z.boolean(),
  message: z.string(),
});

/** The only failure sentence this route produces. See the header. */
const GENERIC_FAILURE = 'That code is not valid.';

export async function POST(request: Request): Promise<NextResponse> {
  assertFeatureEnabled('FEATURE_PHONE_OTP');

  const parsed = VerifySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    /*
     * A malformed body gets the SAME sentence as a wrong code. "Your code must
     * be six digits" tells someone probing that the shape matters and the
     * number did not; the person who mistyped can see the field either way.
     */
    return NextResponse.json(ResponseSchema.parse({ ok: false, message: GENERIC_FAILURE }), {
      status: 400,
    });
  }

  const env = getServerEnv();

  const gate = await checkAll([
    {
      limiter: createRateLimiter(RATE_LIMITS.phoneSignInVerifyPerPhone, env),
      key: parsed.data.phoneNumber,
    },
    { limiter: createRateLimiter(RATE_LIMITS.otpVerifyPerIp, env), key: clientIp(request) },
  ]);

  if (!gate.allowed) {
    return NextResponse.json(
      ResponseSchema.parse({
        ok: false,
        message: `Too many attempts. Try again after ${gate.resetAt.toISOString()}.`,
      }),
      { status: 429 },
    );
  }

  const outcome = await completePhoneSignIn(
    { db: getDb(), provider: resolveOtpProvider(env), secret: getAuthSecret(env) },
    parsed.data.phoneNumber,
    parsed.data.code,
  );

  if (!outcome.ok) {
    return NextResponse.json(ResponseSchema.parse({ ok: false, message: GENERIC_FAILURE }), {
      status: 400,
    });
  }

  const response = NextResponse.json(
    ResponseSchema.parse({ ok: true, message: 'Signed in.' }),
    { status: 200 },
  );

  /*
   * The same cookie Auth.js sets, from the same function.
   *
   * `expires` comes from the service rather than being recomputed here, so the
   * cookie cannot outlive the row it points at — a cookie that survives its
   * session is not a security hole, but it is an unexplained sign-out.
   */
  const cookie = sessionCookie(env.NODE_ENV);
  response.cookies.set(cookie.name, outcome.sessionToken, {
    ...cookie.options,
    expires: outcome.expires,
  });

  return response;
}
