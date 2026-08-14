/**
 * Masks an address for the "check your email" panel.
 *
 * Enough for someone to recognise their own typo, without printing a full
 * address on a screen another person may be looking at.
 *
 * Lives here rather than beside the server action because a `'use server'`
 * module may only export async functions — and because a pure string function
 * has no business being a network round trip.
 */
export function maskEmail(email: string): string {
  const [local = '', domain = ''] = email.split('@');
  if (!domain) return email;

  const masked =
    local.length <= 2
      ? '*'.repeat(Math.max(1, local.length))
      : `${local.slice(0, 2)}${'*'.repeat(local.length - 2)}`;

  return `${masked}@${domain}`;
}
