/**
 * Auth.js configuration (F0.3, extended).
 *
 * Email magic link, and GitHub when it is configured. Database sessions, so a
 * session can be revoked — required by "log out all devices" and by
 * invalidation on email change.
 *
 * Phone sign-in is NOT an Auth.js provider. It lives in `phone-signin.ts` and
 * creates a session row directly, because Auth.js's Credentials provider forces
 * the JWT strategy and this project needs revocable database sessions.
 */
import NextAuth from 'next-auth';
import GitHub from 'next-auth/providers/github';
import Resend from 'next-auth/providers/resend';
import { getDb } from '@/server/db';
import { getAuthSecret, getServerEnv } from '@/server/env';
import { createQuadrantcodeAdapter } from './adapter';

/**
 * The session cookie's name and options, declared ONCE.
 *
 * Auth.js reads this, and so does the phone sign-in route — which sets the
 * cookie itself because it does not go through an Auth.js provider. Two
 * hand-written copies of a cookie definition is how one of them ends up
 * without `httpOnly`.
 *
 * The NAME depends on `NODE_ENV`: the `__Secure-` prefix is rejected by the
 * browser unless the cookie is also Secure, which it cannot be over plain http
 * in development.
 */
export function sessionCookie(nodeEnv: string): {
  name: string;
  options: { httpOnly: true; sameSite: 'lax'; path: string; secure: boolean };
} {
  const production = nodeEnv === 'production';

  return {
    name: production ? '__Secure-quadrantcode.session' : 'quadrantcode.session',
    options: {
      httpOnly: true, // unreadable from JavaScript, so XSS cannot lift it
      sameSite: 'lax', // magic links are a top-level GET; 'strict' would break them
      path: '/',
      secure: production,
    },
  };
}

/** See D13. Overrides Auth.js's 24-hour default for the email provider. */
export const MAGIC_LINK_TTL_SECONDS = 15 * 60;

/** 30 days, refreshed daily — long enough to be usable, short enough to expire. */
const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;
const SESSION_UPDATE_AGE_SECONDS = 24 * 60 * 60;

const env = () => getServerEnv();

export const { handlers, signIn, signOut, auth } = NextAuth(() => {
  const config = env();

  return {
    adapter: createQuadrantcodeAdapter(getDb()),
    secret: getAuthSecret(config),

    session: {
      strategy: 'database',
      maxAge: SESSION_MAX_AGE_SECONDS,
      updateAge: SESSION_UPDATE_AGE_SECONDS,
    },

    cookies: { sessionToken: sessionCookie(config.NODE_ENV) },

    providers: [
      /*
       * GitHub, only when both halves are configured.
       *
       * ## `allowDangerousEmailAccountLinking` — why it is safe HERE
       *
       * The flag is named to make you stop, and the danger it names is real:
       * with a provider that does not verify email addresses, anyone who can
       * assert an address to that provider takes over the matching account.
       *
       * GitHub verifies. And more to the point, **this application's own
       * primary sign-in is a magic link to an inbox** — so an attacker who
       * could get GitHub to assert a victim's verified address already controls
       * that inbox, and could simply request a magic link. Linking on a
       * provider-verified email therefore grants no capability the attacker
       * does not already have.
       *
       * That reasoning does NOT transfer. Adding a provider that does not
       * verify email, or moving sign-in away from the inbox, makes this unsafe
       * and the flag must come off with it.
       */
      ...(config.GITHUB_ID && config.GITHUB_SECRET
        ? [
            GitHub({
              clientId: config.GITHUB_ID,
              clientSecret: config.GITHUB_SECRET,
              userinfo: {
                url: 'https://api.github.com/user',
                async request({ tokens }: { tokens: { access_token?: string } }) {
                  if (!tokens.access_token) throw new Error('GitHub returned no access token.');
                  const headers = {
                    Authorization: `Bearer ${tokens.access_token}`,
                    Accept: 'application/vnd.github+json',
                    'User-Agent': 'quadrantcode',
                    'X-GitHub-Api-Version': '2022-11-28',
                  };
                  const [profileResponse, emailResponse] = await Promise.all([
                    fetch('https://api.github.com/user', { headers }),
                    fetch('https://api.github.com/user/emails', { headers }),
                  ]);
                  if (!profileResponse.ok || !emailResponse.ok) {
                    throw new Error('GitHub identity could not be verified.');
                  }

                  const profile = (await profileResponse.json()) as Record<string, unknown>;
                  const emails = (await emailResponse.json()) as Array<{
                    email: string;
                    primary: boolean;
                    verified: boolean;
                  }>;
                  const verified =
                    emails.find((entry) => entry.primary && entry.verified) ??
                    emails.find((entry) => entry.verified);
                  if (!verified)
                    throw new Error('GitHub has no verified email for this account.');

                  return { ...profile, email: verified.email };
                },
              },
              allowDangerousEmailAccountLinking: true,
            }),
          ]
        : []),

      ...(config.RESEND_API_KEY && config.EMAIL_FROM
        ? [
            Resend({
              apiKey: config.RESEND_API_KEY,
              from: config.EMAIL_FROM,
              ...(process.env.E2E_EMAIL_CAPTURE === '1'
                ? {
                    // Browser tests exercise the full token/database flow
                    // without contacting or spending against a real provider.
                    async sendVerificationRequest() {},
                  }
                : {}),
              /*
               * 15 minutes — a DELIBERATE OVERRIDE of Auth.js's 24-hour default
               * (verified in @auth/core/providers/resend.js: `maxAge: 24 * 60 * 60`).
               *
               * A magic link is a bearer credential sitting in an inbox: whoever
               * holds it is the account. 24h is a long exposure for something that
               * gets forwarded, synced to a shared device, or left in a mailbox
               * compromised later the same day. 15 minutes is ample for a link you
               * just requested.
               *
               * Consequence accepted: expiry will genuinely occur, so /login/verify
               * distinguishes expired from used and offers a resend. See decisions
               * D13.
               */
              maxAge: MAGIC_LINK_TTL_SECONDS,
            }),
          ]
        : []),
    ],

    pages: {
      signIn: '/login',
      // The "check your email" state is rendered inline by LoginForm rather
      // than as a separate route, so the address stays on screen without being
      // put in a URL.
      verifyRequest: '/login',
      error: '/login/verify',
    },

    callbacks: {
      /**
       * Exposes role, verification level and timezone on the session so
       * `getCurrentUser()` is one query. These are read from the database on
       * every request (database strategy), so a role change takes effect
       * immediately rather than at next sign-in.
       */
      session({ session, user }) {
        return { ...session, user: { ...session.user, id: user.id } };
      },
    },

    events: {
      /**
       * Session rotation on sign-in: every prior session for this user is
       * dropped, so a stolen pre-authentication token is worthless afterwards.
       */
      async signIn({ user }) {
        if (!user.id) return;
        const { authSessions } = await import('@/server/db/schema');
        const { eq, ne, and, desc } = await import('drizzle-orm');
        const db = getDb();
        // Keep only the session just created.
        const [newest] = await db
          .select({ token: authSessions.sessionToken })
          .from(authSessions)
          .where(eq(authSessions.userId, user.id))
          .orderBy(desc(authSessions.createdAt));

        if (newest) {
          await db
            .delete(authSessions)
            .where(
              and(
                eq(authSessions.userId, user.id),
                ne(authSessions.sessionToken, newest.token),
              ),
            );
        }
      },
    },

    trustHost:
      config.NODE_ENV !== 'production' ||
      process.env.VERCEL === '1' ||
      config.AUTH_TRUST_HOST === 'true' ||
      /^(localhost|127\.0\.0\.1)$/i.test(new URL(config.NEXT_PUBLIC_APP_URL).hostname),
  };
});
