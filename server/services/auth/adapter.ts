/**
 * Hand-written Auth.js adapter over the F0.2 schema.
 *
 * `@auth/drizzle-adapter` insists on its own column names (`emailVerified`,
 * `name`, `image`). F0.2 fixes ours (`email_verified_at`, and profile fields
 * live in `user_profiles`). Reshaping the core identity table to suit a
 * library would have been the wrong trade, so this file maps between the two
 * shapes instead. It is the only place that translation happens.
 */
import { and, eq } from 'drizzle-orm';
import type { Adapter, AdapterAccount, AdapterSession, AdapterUser } from 'next-auth/adapters';
import type { Database } from '@/server/db';
import {
  authAccounts,
  authSessions,
  authVerificationTokens,
  userProfiles,
  users,
} from '@/server/db/schema';

type UserRow = typeof users.$inferSelect;

function toAdapterUser(row: UserRow, displayName?: string | null, avatarUrl?: string | null) {
  return {
    id: row.id,
    email: row.email,
    emailVerified: row.emailVerifiedAt,
    name: displayName ?? null,
    image: avatarUrl ?? null,
  } satisfies AdapterUser;
}

export function createTraceLoopAdapter(db: Database): Adapter {
  async function readUser(where: ReturnType<typeof eq>): Promise<AdapterUser | null> {
    const [row] = await db
      .select({ user: users, profile: userProfiles })
      .from(users)
      .leftJoin(userProfiles, eq(userProfiles.userId, users.id))
      .where(where)
      .limit(1);

    if (!row) return null;
    return toAdapterUser(row.user, row.profile?.displayName, row.profile?.avatarUrl);
  }

  return {
    async createUser(user) {
      // Emails are stored lowercase — the `users_email_lowercase` CHECK
      // enforces it, so normalise here rather than hitting a constraint error.
      const email = user.email.toLowerCase();

      const [row] = await db
        .insert(users)
        .values({ email, emailVerifiedAt: user.emailVerified ?? null })
        .returning();

      if (!row) throw new Error('createUser: insert returned no row');

      await db
        .insert(userProfiles)
        .values({
          userId: row.id,
          displayName: user.name ?? null,
          avatarUrl: user.image ?? null,
        })
        .onConflictDoNothing();

      return toAdapterUser(row, user.name, user.image);
    },

    getUser: (id) => readUser(eq(users.id, id)),

    getUserByEmail: (email) => readUser(eq(users.email, email.toLowerCase())),

    async getUserByAccount({ provider, providerAccountId }) {
      const [link] = await db
        .select({ userId: authAccounts.userId })
        .from(authAccounts)
        .where(
          and(
            eq(authAccounts.provider, provider),
            eq(authAccounts.providerAccountId, providerAccountId),
          ),
        )
        .limit(1);

      return link ? readUser(eq(users.id, link.userId)) : null;
    },

    async updateUser(user) {
      if (!user.id) throw new Error('updateUser: id is required');

      const [row] = await db
        .update(users)
        .set({
          ...(user.email ? { email: user.email.toLowerCase() } : {}),
          ...(user.emailVerified !== undefined ? { emailVerifiedAt: user.emailVerified } : {}),
        })
        .where(eq(users.id, user.id))
        .returning();

      if (!row) throw new Error(`updateUser: no user ${user.id}`);

      // Changing the email invalidates every existing session (F4.8).
      if (user.email) {
        await db.delete(authSessions).where(eq(authSessions.userId, row.id));
      }

      return toAdapterUser(row, user.name, user.image);
    },

    async deleteUser(userId) {
      await db.delete(users).where(eq(users.id, userId));
    },

    async linkAccount(account: AdapterAccount) {
      await db.insert(authAccounts).values({
        userId: account.userId,
        provider: account.provider,
        providerAccountId: account.providerAccountId,
        type: account.type,
        refreshToken: account.refresh_token ?? null,
        accessToken: account.access_token ?? null,
        expiresAt: account.expires_at ? new Date(account.expires_at * 1000) : null,
        tokenType: account.token_type ?? null,
        scope: account.scope ?? null,
        idToken: account.id_token ?? null,
        sessionState: typeof account.session_state === 'string' ? account.session_state : null,
      });
    },

    async unlinkAccount({ provider, providerAccountId }) {
      await db
        .delete(authAccounts)
        .where(
          and(
            eq(authAccounts.provider, provider),
            eq(authAccounts.providerAccountId, providerAccountId),
          ),
        );
    },

    async createSession(session) {
      const [row] = await db.insert(authSessions).values(session).returning();
      if (!row) throw new Error('createSession: insert returned no row');
      return row satisfies AdapterSession;
    },

    async getSessionAndUser(sessionToken) {
      const [row] = await db
        .select({ session: authSessions, user: users, profile: userProfiles })
        .from(authSessions)
        .innerJoin(users, eq(users.id, authSessions.userId))
        .leftJoin(userProfiles, eq(userProfiles.userId, users.id))
        .where(eq(authSessions.sessionToken, sessionToken))
        .limit(1);

      if (!row) return null;

      // A soft-deleted account keeps its rows but must not authenticate.
      if (row.user.deletedAt !== null) return null;

      return {
        session: row.session satisfies AdapterSession,
        user: toAdapterUser(row.user, row.profile?.displayName, row.profile?.avatarUrl),
      };
    },

    async updateSession(session) {
      const [row] = await db
        .update(authSessions)
        .set({ expires: session.expires })
        .where(eq(authSessions.sessionToken, session.sessionToken))
        .returning();

      return row ?? null;
    },

    async deleteSession(sessionToken) {
      await db.delete(authSessions).where(eq(authSessions.sessionToken, sessionToken));
    },

    async createVerificationToken(token) {
      const [row] = await db.insert(authVerificationTokens).values(token).returning();
      return row ?? null;
    },

    /** Single-use: the row is deleted as it is read, so a replayed link fails. */
    async useVerificationToken({ identifier, token }) {
      const [row] = await db
        .delete(authVerificationTokens)
        .where(
          and(
            eq(authVerificationTokens.identifier, identifier),
            eq(authVerificationTokens.token, token),
          ),
        )
        .returning();

      return row ?? null;
    },
  };
}
