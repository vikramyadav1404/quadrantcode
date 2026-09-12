/**
 * Auth.js adapter = `@auth/drizzle-adapter` + three app rules.
 *
 * The library owns session tokens, verification tokens and account linking —
 * the security-sensitive parts. This file only decorates three methods, so the
 * maintained surface is the wrapper, not a reimplementation.
 *
 * Column mapping instead of table reshaping: `users.emailVerified` is declared
 * as `timestamp('email_verified_at')`, so the adapter gets the property name it
 * requires while the SQL column stays what F0.2 specifies. Same trick on
 * `auth_accounts`.
 *
 * The one cast below is `usersTable`: the adapter's TYPE demands `name` and
 * `image` columns, but its runtime never requires them — `createUser` does
 * `.values(data)` and Drizzle drops keys that are not columns. Verified against
 * a real database in `tests/auth/adapter.test.ts`, which fails if a future
 * version of the adapter starts depending on them. Adding two unused columns
 * that duplicate `user_profiles.display_name` / `.avatar_url` would be a worse
 * data model than one asserted cast.
 */
import { DrizzleAdapter } from '@auth/drizzle-adapter';
import { and, eq, isNull } from 'drizzle-orm';
import type { Adapter, AdapterUser } from 'next-auth/adapters';
import type { Database } from '@/server/db';
import {
  authAccounts,
  authSessions,
  authVerificationTokens,
  userProfiles,
  users,
} from '@/server/db/schema';

export function createQuadrantcodeAdapter(db: Database): Adapter {
  const base = DrizzleAdapter(db, {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- see header: adapter type demands name/image columns its runtime never reads
    usersTable: users as any,
    accountsTable: authAccounts,
    sessionsTable: authSessions,
    verificationTokensTable: authVerificationTokens,
  });

  return {
    ...base,

    /**
     * Rule 1 — emails are stored lowercase (the `users_email_lowercase` CHECK
     * enforces it, so normalise before the insert rather than hitting a
     * constraint error).
     * Rule 2 — every user gets a `user_profiles` row, so later features never
     * have to handle a missing profile.
     */
    async createUser(user) {
      const created = await base.createUser!({ ...user, email: user.email.toLowerCase() });

      await db.insert(userProfiles).values({ userId: created.id }).onConflictDoNothing();

      return created;
    },

    /** Rule 1 again, plus: changing the email invalidates every session (F4.8). */
    async updateUser(user) {
      const updated = await base.updateUser!({
        ...user,
        ...(user.email ? { email: user.email.toLowerCase() } : {}),
      });

      if (user.email) {
        await db.delete(authSessions).where(eq(authSessions.userId, updated.id));
      }

      return updated;
    },

    /**
     * Rule 4 — consuming a magic-link token MARKS it rather than deleting it.
     *
     * The stock adapter does `DELETE ... RETURNING`, which makes "already used"
     * and "never existed" indistinguishable afterwards — /login/verify then has
     * to show one generic error for two situations with different remedies.
     *
     * The `IS NULL` guard also makes single-use ATOMIC. A SELECT-then-DELETE
     * has a window where two simultaneous clicks both read an unconsumed row;
     * a single conditional UPDATE cannot, because Postgres serialises the two
     * writes and only the first matches the predicate.
     */
    async useVerificationToken({ identifier, token }) {
      const [row] = await db
        .update(authVerificationTokens)
        .set({ consumedAt: new Date() })
        .where(
          and(
            eq(authVerificationTokens.identifier, identifier),
            eq(authVerificationTokens.token, token),
            isNull(authVerificationTokens.consumedAt),
          ),
        )
        .returning();

      // Auth.js reads `expires` off the returned row and decides expiry itself,
      // so an expired-but-unconsumed token is returned here and rejected there.
      return row ?? null;
    },

    /**
     * Rule 3 — a soft-deleted account keeps its rows but must not authenticate.
     * The stock adapter has no concept of `deleted_at`, so this check cannot
     * live anywhere else.
     */
    async getSessionAndUser(sessionToken) {
      const result = await base.getSessionAndUser!(sessionToken);
      if (!result) return null;

      const [row] = await db
        .select({ deletedAt: users.deletedAt })
        .from(users)
        .where(eq(users.id, result.user.id))
        .limit(1);

      if (!row || row.deletedAt !== null) return null;
      return result as { session: typeof result.session; user: AdapterUser };
    },
  };
}
