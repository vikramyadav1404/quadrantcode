/**
 * POST /api/avatar/confirm — Phase B.
 *
 * Where trust is established. Nothing the client said is believed: ownership,
 * existence, real byte size and magic bytes are all re-checked, and any
 * failure deletes the uploaded object.
 */
import { NextResponse } from 'next/server';
import { confirmAvatarSchema } from '@/lib/profile/schemas';
import { getDb } from '@/server/db';
import { getServerEnv } from '@/server/env';
import { AvatarError, confirmAvatarUpload, removeAvatar } from '@/server/services/profile';
import { getCurrentUser } from '@/server/services/auth/session';
import { resolveStorage } from '@/server/services/storage';

export async function POST(request: Request): Promise<NextResponse> {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ ok: false, message: 'Sign in first.' }, { status: 401 });
  }

  const parsed = confirmAvatarSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, message: 'That upload is not valid.' },
      { status: 400 },
    );
  }

  const env = getServerEnv();

  try {
    const { avatarUrl } = await confirmAvatarUpload(
      { db: getDb(), storage: resolveStorage(env) },
      user.id,
      { key: parsed.data.key, declaredSizeBytes: parsed.data.sizeBytes },
    );

    // The URL is BUILT server-side from the key and returned for rendering.
    // It is never accepted from the client.
    return NextResponse.json({ ok: true, avatarUrl });
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

/**
 * DELETE /api/avatar/confirm — "Remove avatar".
 *
 * Deletes the object and nulls the column; the UI falls back to initials. On
 * the same route because it operates on the same resource.
 */
export async function DELETE(): Promise<NextResponse> {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ ok: false, message: 'Sign in first.' }, { status: 401 });
  }

  const env = getServerEnv();
  await removeAvatar({ db: getDb(), storage: resolveStorage(env) }, user.id);

  return NextResponse.json({ ok: true });
}
