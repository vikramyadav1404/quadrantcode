/**
 * Auth.js persistence (F0.3).
 *
 * DATABASE sessions, not JWTs. A JWT cannot be revoked, and F4.8 requires
 * "log out all devices" plus session invalidation on email change — both of
 * which need a server-side row to delete.
 *
 * These tables back a small hand-written Auth.js adapter
 * (`server/services/auth/adapter.ts`) rather than `@auth/drizzle-adapter`,
 * because F0.2 fixes the `users` column names (`email_verified_at`) and the
 * stock adapter insists on its own (`emailVerified`). Owning ~150 lines of
 * adapter is cheaper than reshaping the core identity table to suit a library.
 */
import { index, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { users } from './users';

/** OAuth links. Empty today (email magic link only) — declared so adding a provider is not a migration scramble. */
export const authAccounts = pgTable(
  'auth_accounts',
  {
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    provider: text().notNull(),
    providerAccountId: text().notNull(),
    type: text().notNull(),
    refreshToken: text(),
    accessToken: text(),
    expiresAt: timestamp({ withTimezone: true }),
    tokenType: text(),
    scope: text(),
    idToken: text(),
    sessionState: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.provider, table.providerAccountId] }),
    index('auth_accounts_user_idx').on(table.userId),
  ],
);

export const authSessions = pgTable(
  'auth_sessions',
  {
    /** Opaque random token stored in the httpOnly cookie. */
    sessionToken: text().primaryKey(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expires: timestamp({ withTimezone: true }).notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    /**
     * Serves: "invalidate every session for this user" — the log-out-all-devices
     * action and the forced revocation on email change.
     *   DELETE FROM auth_sessions WHERE user_id = $1
     */
    index('auth_sessions_user_idx').on(table.userId),
  ],
);

/** Single-use magic-link tokens. Rows are deleted on use, never marked. */
export const authVerificationTokens = pgTable(
  'auth_verification_tokens',
  {
    identifier: text().notNull(),
    token: text().notNull(),
    expires: timestamp({ withTimezone: true }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.identifier, table.token] })],
);
