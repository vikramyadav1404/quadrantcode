/**
 * POST /api/otp/request — issue a phone verification code.
 *
 * Thin adapter: Zod at the boundary, rate limits, then straight into
 * `requestPhoneOtp`. No business rule lives here.
 *
 * The response is deliberately identical for success, "number already
 * registered" and "rate limited by phone", so the endpoint cannot be used to
 * enumerate which numbers have accounts. Only a genuine IP-level limit
 * returns 429, because that one is about protecting us, not about the user.
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getEnv } from '@/lib/env';
import { assertFeatureEnabled } from '@/lib/flags';
import { getDb } from '@/server/db';
import { RATE_LIMITS, checkAll, createRateLimiter } from '@/server/lib/ratelimit';
import { genericOtpErrorMessage, requestPhoneOtp } from '@/server/services/auth/otp';
import { getCurrentUser } from '@/server/services/auth/session';
import { resolveOtpProvider } from '@/server/services/otp';

const RequestSchema = z.object({
  phoneNumber: z.string().min(8).max(20),
});

const ResponseSchema = z.object({
  ok: z.boolean(),
  message: z.string(),
});

function clientIp(request: Request): string {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    request.headers.get('x-real-ip') ??
    'unknown'
  );
}

export async function POST(request: Request): Promise<NextResponse> {
  assertFeatureEnabled('FEATURE_PHONE_OTP');

  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ ok: false, message: 'Sign in first.' }, { status: 401 });
  }

  const parsed = RequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, message: 'Enter a valid phone number.' },
      { status: 400 },
    );
  }

  const env = getEnv();
  const ip = clientIp(request);

  const gate = await checkAll([
    {
      limiter: createRateLimiter(RATE_LIMITS.otpRequestPerPhone, env),
      key: parsed.data.phoneNumber,
    },
    { limiter: createRateLimiter(RATE_LIMITS.otpRequestPerIp, env), key: ip },
  ]);

  if (!gate.allowed) {
    return NextResponse.json(
      {
        ok: false,
        message: `Too many requests. Try again after ${gate.resetAt.toISOString()}.`,
      },
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

  const outcome = await requestPhoneOtp(
    { db: getDb(), provider: resolveOtpProvider(env), secret: env.AUTH_SECRET ?? 'dev-secret' },
    user.id,
    parsed.data.phoneNumber,
  );

  // Uniform response — see the file header.
  const body = ResponseSchema.parse({
    ok: outcome.ok,
    message: outcome.ok
      ? 'If that number can receive codes, one is on its way.'
      : genericOtpErrorMessage(),
  });

  return NextResponse.json(outcome.ok ? body : { ...body, ok: true, message: body.message }, {
    status: 200,
  });
}
