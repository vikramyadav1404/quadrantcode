/**
 * Which transport delivers sign-in links, decided in ONE place.
 *
 * Two are supported:
 *
 * - **Resend** — `RESEND_API_KEY` + `EMAIL_FROM`. Needs a verified sending
 *   domain (SPF/DKIM) before it will deliver to anyone but the account owner.
 * - **Gmail SMTP** — `GMAIL_USER` + `GMAIL_APP_PASSWORD`. Free, needs no DNS,
 *   and the same Gmail-account approach Nexora uses. Gmail rewrites the From address to
 *   the authenticated account, so `EMAIL_FROM` only changes the display name.
 *
 * Resend wins when both are configured: it is the transport with real
 * deliverability controls, and Gmail is the zero-cost fallback.
 *
 * Every reader — the Auth.js config, the login page, the server action,
 * readiness, health and the deploy gate — asks this module instead of testing
 * env names itself. Six hand-written copies of "is email configured" is how one
 * of them ends up checking only Resend.
 *
 * Not a Next.js module: `scripts/check-deployment-env.ts` runs under plain
 * `tsx`, so this file must stay free of `server-only`.
 */

export type EmailDelivery = 'resend' | 'gmail';

type EmailEnv = {
  RESEND_API_KEY?: string | undefined;
  EMAIL_FROM?: string | undefined;
  GMAIL_USER?: string | undefined;
  GMAIL_APP_PASSWORD?: string | undefined;
};

/**
 * The Auth.js provider id for each transport. It is also the last segment of
 * the callback URL (`/api/auth/callback/<id>`), so `resend` keeps its id and
 * existing links and e2e helpers keep working.
 */
export const EMAIL_PROVIDER_ID: Record<EmailDelivery, string> = {
  resend: 'resend',
  gmail: 'gmail',
};

function present(value: string | undefined): boolean {
  return Boolean(value && value.trim());
}

export function resolveEmailDelivery(env: EmailEnv): EmailDelivery | null {
  if (present(env.RESEND_API_KEY) && present(env.EMAIL_FROM)) return 'resend';
  if (present(env.GMAIL_USER) && present(env.GMAIL_APP_PASSWORD)) return 'gmail';
  return null;
}

/**
 * Google shows app passwords in four groups of four ("abcd efgh ijkl mnop").
 * SMTP needs the 16 characters without the spaces, and a pasted value often
 * carries them.
 */
export function normaliseAppPassword(value: string): string {
  return value.replace(/\s+/g, '');
}

/** The From header for Gmail: `EMAIL_FROM` if set, else the Gmail account. */
export function gmailFrom(env: EmailEnv): string {
  const configured = env.EMAIL_FROM?.trim();
  if (configured) return configured;
  return `Quadrantcode <${(env.GMAIL_USER ?? '').trim()}>`;
}
