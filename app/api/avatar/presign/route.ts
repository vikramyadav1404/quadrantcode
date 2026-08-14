/**
 * POST /api/avatar/presign — Phase A.
 *
 * Returns a short-lived URL the BROWSER uploads to directly. The file never
 * passes through this handler: Vercel caps a serverless request body around
 * 4.5MB, so proxying works in dev and fails in production.
 */
import { NextResponse } from 'next/server';
import { presignAvatarSchema } from '@/lib/profile/schemas';
import { getDb } from '@/server/db';
import { getServerEnv } from '@/server/env';
import { RATE_LIMITS, createRateLimiter } from '@/server/lib/ratelimit';
import { AvatarError, presignAvatarUpload } from '@/server/services/profile';
import { getCurrentUser } from '@/server/services/auth/session';
import { resolveStorage } from '@/server/services/storage';

export async function POST(request: Request): Promise<NextResponse> {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ ok: false, message: 'Sign in first.' }, { status: 401 });
  }

  const parsed = presignAvatarSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, message: 'Avatars must be a JPEG, PNG or WebP under 2MB.' },
      { status: 400 },
    );
  }

  const env = getServerEnv();

  // 10 per user per hour — a presign is cheap but it signs a write to storage.
  const gate = await createRateLimiter(RATE_LIMITS.avatarPresignPerUser, env).limit(user.id);
  if (!gate.allowed) {
    return NextResponse.json(
      {
        ok: false,
        message: `Too many upload attempts. Try again after ${gate.resetAt.toISOString()}.`,
      },
      { status: 429 },
    );
  }

  try {
    // userId is taken from the SESSION. A userId in the payload is ignored.
    const result = await presignAvatarUpload(
      { db: getDb(), storage: resolveStorage(env) },
      user.id,
      parsed.data,
    );

    return NextResponse.json({
      ok: true,
      uploadUrl: result.uploadUrl,
      key: result.key,
      expiresAt: result.expiresAt.toISOString(),
    });
  } catch (error) {
    if (error instanceof AvatarError) {
      return NextResponse.json(
        { ok: false, code: error.code, message: error.message },
        { status: error.status },
      );
    }
    throw error;
  }
}
