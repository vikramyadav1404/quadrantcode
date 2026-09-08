'use server';

/**
 * The ONE entry point for sending a magic link.
 *
 * `/login` and the expired-link state on `/login/verify` both call this. That
 * is the point: a resend button that reached Auth.js by another path would skip
 * the cooldown, and the expired page would become a bypass of it — which at a
 * 15-minute TTL (D13) is a page users will actually reach.
 *
 * The 60-second countdown in the UI is a display of `retryAfterSeconds`
 * returned from here. It is never the control: component state resets on
 * reload, and there are two entry points.
 */
import { z } from 'zod';
import { getServerEnv } from '@/server/env';
import { RATE_LIMITS, createRateLimiter } from '@/server/lib/ratelimit';
import { signIn } from '@/server/services/auth/config';
import { validateReturnTo } from '@/lib/auth/return-to';
import { maskEmail } from '@/lib/auth/mask-email';

const requestSchema = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email address'),
  returnTo: z.string().optional(),
});

export type SendLinkResult =
  | { ok: true; maskedEmail: string; cooldownSeconds: number }
  | { ok: false; message: string; retryAfterSeconds?: number };

export async function sendMagicLinkAction(formData: unknown): Promise<SendLinkResult> {
  const parsed = requestSchema.safeParse(formData);
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? 'Enter a valid email address.',
    };
  }

  const { email, returnTo } = parsed.data;
  const env = getServerEnv();
  if (!env.RESEND_API_KEY || !env.EMAIL_FROM) {
    return { ok: false, message: 'Email sign-in is temporarily unavailable.' };
  }

  // 1. The 60-second cooldown, keyed by address.
  const cooldown = await createRateLimiter(RATE_LIMITS.magicLinkResendCooldown, env).limit(
    email,
  );
  if (!cooldown.allowed) {
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((cooldown.resetAt.getTime() - Date.now()) / 1000),
    );
    return {
      ok: false,
      message: `Wait ${retryAfterSeconds}s before requesting another link.`,
      retryAfterSeconds,
    };
  }

  // 2. The hourly cap, so the cooldown cannot be ground down over an hour.
  const hourly = await createRateLimiter(RATE_LIMITS.magicLinkPerEmail, env).limit(email);
  if (!hourly.allowed) {
    return {
      ok: false,
      message: 'Too many sign-in links requested for this address. Try again later.',
    };
  }

  const safeReturnTo = validateReturnTo(returnTo, env.NEXT_PUBLIC_APP_URL) ?? '/dashboard';

  try {
    await signIn('resend', {
      email,
      redirect: false,
      redirectTo: safeReturnTo,
    });
  } catch (error) {
    // Never reveal whether the address is registered — the response below is
    // identical either way. Delivery failures are logged, not surfaced.
    console.error(
      JSON.stringify({
        event: 'auth.magic_link_send_failed',
        reason: error instanceof Error ? error.name : 'unknown',
      }),
    );
  }

  // 3. Uniform success, whether or not that address has an account.
  return {
    ok: true,
    maskedEmail: maskEmail(email),
    cooldownSeconds: RATE_LIMITS.magicLinkResendCooldown.windowSeconds,
  };
}

/**
 * F0.3b · hand off to GitHub.
 *
 * A server action rather than a link to `/api/auth/signin/github`, for the same
 * reason `sendMagicLinkAction` exists: `returnTo` is attacker-supplied, and
 * `validateReturnTo` is the allowlist that keeps it from becoming an open
 * redirect. A hand-built URL would skip it.
 *
 * This one DOES redirect — `signIn` throws a Next.js redirect, which is how
 * server actions navigate. It must not be caught: swallowing it here would
 * leave the user on /login with nothing having happened. That is why the
 * magic-link action's try/catch is not copied down.
 */
export async function signInWithGitHubAction(returnTo?: string): Promise<void> {
  const env = getServerEnv();
  if (!env.GITHUB_ID || !env.GITHUB_SECRET) return;

  const safeReturnTo = validateReturnTo(returnTo, env.NEXT_PUBLIC_APP_URL) ?? '/dashboard';

  await signIn('github', { redirectTo: safeReturnTo });
}
