'use server';

/**
 * Onboarding writes through F0.5's `updateProfile` — the same path
 * /settings/profile uses. A second write path for the same three columns is
 * how validation rules end up applied in one place and not the other.
 */
import { getDb } from '@/server/db';
import { resolveReturnTo } from '@/lib/auth/return-to';
import { getServerEnv } from '@/server/env';
import { requireCurrentUser } from '@/server/services/auth/session';
import { hasCompletedProfile, updateProfile } from '@/server/services/profile';

export type OnboardingResult = { ok: true; next: string } | { ok: false; message: string };

export async function completeOnboardingAction(payload: unknown): Promise<OnboardingResult> {
  const user = await requireCurrentUser();
  const db = getDb();

  // Idempotent: a double submit does not re-run onboarding.
  if (await hasCompletedProfile(db, user.id)) {
    return { ok: true, next: '/dashboard' };
  }

  const input = (payload ?? {}) as Record<string, unknown>;

  try {
    await updateProfile(db, user.id, {
      displayName: input.displayName,
      targetRole: input.targetRole || undefined,
      timezone: input.timezone,
      publicProfileEnabled: false,
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'ZodError') {
      return { ok: false, message: 'Check the highlighted fields and try again.' };
    }
    throw error;
  }

  const env = getServerEnv();
  return {
    ok: true,
    next: resolveReturnTo(input.returnTo, env.NEXT_PUBLIC_APP_URL, user.role),
  };
}
