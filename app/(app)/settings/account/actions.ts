'use server';

/**
 * Connecting and disconnecting a sign-in provider.
 *
 * Both actions resolve the user from the SESSION and never from an argument.
 * The only thing the browser gets to say is which provider it means, and that
 * is validated against a closed list before it reaches a query — so the worst a
 * forged submission can do is unlink the caller's own GitHub.
 */
import { z } from 'zod';
import { getDb } from '@/server/db';
import { getServerEnv } from '@/server/env';
import { signIn } from '@/server/services/auth/config';
import { LINKABLE_PROVIDERS, disconnectProvider } from '@/server/services/auth/connections';
import { getCurrentUser } from '@/server/services/auth/session';
import { revalidatePath } from 'next/cache';

const ProviderSchema = z.enum(LINKABLE_PROVIDERS);

export type ConnectionResult = { ok: true } | { ok: false; message: string };

/**
 * Start the OAuth hand-off that LINKS a provider to the signed-in account.
 *
 * There is no separate "link" endpoint in Auth.js — linking is what signing in
 * with a provider does when the verified email matches an existing user, which
 * `allowDangerousEmailAccountLinking` permits and `config.ts` explains at
 * length. So this is the same `signIn` call the login page makes; the
 * difference is only that a session already exists.
 *
 * `redirectTo` is a fixed internal path, not user input, so there is no
 * `returnTo` to validate here.
 */
export async function connectProviderAction(provider: string): Promise<ConnectionResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, message: 'Sign in first.' };

  const parsed = ProviderSchema.safeParse(provider);
  if (!parsed.success) return { ok: false, message: 'Unknown provider.' };

  const env = getServerEnv();
  if (!env.GITHUB_ID || !env.GITHUB_SECRET) {
    // The page hides the button in this case; this is the second line of
    // defence for a form submitted from a stale tab.
    return { ok: false, message: 'That provider is not configured.' };
  }

  // Throws a redirect, which is how a server action navigates. Not caught.
  await signIn(parsed.data, { redirectTo: '/settings/account' });

  return { ok: true };
}

export async function disconnectProviderAction(provider: string): Promise<ConnectionResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, message: 'Sign in first.' };

  const parsed = ProviderSchema.safeParse(provider);
  if (!parsed.success) return { ok: false, message: 'Unknown provider.' };

  await disconnectProvider(getDb(), user.id, parsed.data);

  // The page is a server component reading the table; without this the button
  // flips back on the next navigation rather than now.
  revalidatePath('/settings/account');

  return { ok: true };
}
