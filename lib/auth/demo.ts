/**
 * The demo account's identity, declared ONCE.
 *
 * `scripts/demo-seed.ts` seeds this address and `/login` recognises it, so it
 * lives here rather than in either. Two copies of a literal that two features
 * must agree on is the D21 mistake: the day one copy is edited the notice stops
 * appearing, silently and without a failing test.
 *
 * The address is the ONLY available signal. The demo user is `role: 'user'`
 * deliberately (see the seed script's header — an admin demo account plus a
 * printed token would expose the native-content tooling), so the role column
 * cannot tell it apart, and adding an `is_demo` column is a schema change.
 */
export const DEMO_EMAIL = 'demo@quadrantcode.local';

/**
 * Stored emails are already lowercase — the `users_email_lowercase` CHECK sees
 * to that — but this also takes callers that have not normalised, because a
 * case-sensitive comparison here fails open (the demo user gets treated as a
 * real one and is redirected away from the notice).
 */
export function isDemoUser(email: string | null | undefined): boolean {
  return typeof email === 'string' && email.trim().toLowerCase() === DEMO_EMAIL;
}
