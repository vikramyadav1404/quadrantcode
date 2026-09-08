/**
 * POST /api/otp/verify — submit a phone verification code.
 *
 * On success the cached `verification_level` is recomputed from actual state
 * rather than incremented, so the column can never drift from the derived
 * value.
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getAuthSecret, getServerEnv } from '@/server/env';
import { clientIp } from '@/server/lib/client-ip';
import { assertFeatureEnabled } from '@/lib/flags';
import { getDb } from '@/server/db';
import { RATE_LIMITS, checkAll, createRateLimiter } from '@/server/lib/ratelimit';
import { genericOtpErrorMessage, verifyPhoneOtp } from '@/server/services/auth/otp';
import { getCurrentUser } from '@/server/services/auth/session';
import { recomputeVerificationLevel } from '@/server/services/auth/verification-level';
import { resolveOtpProvider } from '@/server/services/otp';

const VerifySchema = z.object({ code: z.string().regex(/^\d{6}$/) });

export async function POST(request: Request): Promise<NextResponse> {
  assertFeatureEnabled('FEATURE_PHONE_OTP');

  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ ok: false, message: 'Sign in first.' }, { status: 401 });
  }

  const parsed = VerifySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    // Same generic message as a wrong code — a malformed body must not be
    // distinguishable from an incorrect one.
    return NextResponse.json({ ok: false, message: genericOtpErrorMessage() }, { status: 400 });
  }

  const env = getServerEnv();
  const gate = await checkAll([
    { limiter: createRateLimiter(RATE_LIMITS.otpVerifyPerUser, env), key: user.id },
    { limiter: createRateLimiter(RATE_LIMITS.otpVerifyPerIp, env), key: clientIp(request) },
  ]);

  if (!gate.allowed) {
    return NextResponse.json(
      {
        ok: false,
        message: `Too many attempts. Try again after ${gate.resetAt.toISOString()}.`,
      },
      { status: 429 },
    );
  }

  const db = getDb();
  const outcome = await verifyPhoneOtp(
    { db, provider: resolveOtpProvider(env), secret: getAuthSecret(env) },
    user.id,
    parsed.data.code,
  );

  if (!outcome.ok) {
    return NextResponse.json({ ok: false, message: genericOtpErrorMessage() }, { status: 400 });
  }

  const { level } = await recomputeVerificationLevel(db, user.id);
  return NextResponse.json({ ok: true, verificationLevel: level }, { status: 200 });
}
