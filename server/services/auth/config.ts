/**
 * Auth.js configuration (F0.3).
 *
 * Email magic link only. Database sessions, so a session can be revoked —
 * required by "log out all devices" and by invalidation on email change.
 */
import NextAuth from 'next-auth';
import Resend from 'next-auth/providers/resend';
import { getDb } from '@/server/db';
import { getServerEnv } from '@/server/env';
import { createTraceLoopAdapter } from './adapter';

/** 30 days, refreshed daily — long enough to be usable, short enough to expire. */
const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;
const SESSION_UPDATE_AGE_SECONDS = 24 * 60 * 60;

const env = () => getServerEnv();

export const { handlers, signIn, signOut, auth } = NextAuth(() => {
  const config = env();

  return {
    adapter: createTraceLoopAdapter(getDb()),
    secret: config.AUTH_SECRET,

    session: {
      strategy: 'database',
      maxAge: SESSION_MAX_AGE_SECONDS,
      updateAge: SESSION_UPDATE_AGE_SECONDS,
    },

    cookies: {
      sessionToken: {
        name:
          config.NODE_ENV === 'production' ? '__Secure-traceloop.session' : 'traceloop.session',
        options: {
          httpOnly: true, // unreadable from JavaScript, so XSS cannot lift it
          sameSite: 'lax', // magic links are a top-level GET; 'strict' would break them
          path: '/',
          secure: config.NODE_ENV === 'production',
        },
      },
    },

    providers: [
      Resend({
        apiKey: config.RESEND_API_KEY ?? '',
        from: config.EMAIL_FROM ?? 'TraceLoop <onboarding@resend.dev>',
        // Magic links expire in 15 minutes, not the 24h default.
        maxAge: 15 * 60,
      }),
    ],

    pages: {
      signIn: '/sign-in',
      verifyRequest: '/sign-in/check-email',
      error: '/sign-in/error',
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
        const { eq, ne, and } = await import('drizzle-orm');
        const db = getDb();
        // Keep only the session just created.
        const [newest] = await db
          .select({ token: authSessions.sessionToken })
          .from(authSessions)
          .where(eq(authSessions.userId, user.id))
          .orderBy(authSessions.createdAt);

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

    trustHost: true,
  };
});
