/**
 * Auth.js persistence (F0.3).
 *
 * DATABASE sessions, not JWTs. A JWT cannot be revoked, and F4.8 requires
 * "log out all devices" plus session invalidation on email change — both of
 * which need a server-side row to delete.
 *
 * These tables back `@auth/drizzle-adapter`. Property names match the adapter's
 * contract; SQL column names are given explicitly where the two differ, since
 * Drizzle decouples them. `server/services/auth/adapter.ts` then wraps the
 * stock adapter to add three app rules — it does not reimplement it.
 */
import {
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
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

    // Property names below are the adapter's contract (snake_case in its
    // AdapterAccount type); the SQL columns are named explicitly so the
    // database keeps this project's conventions.
    refresh_token: text('refresh_token'),
    access_token: text('access_token'),
    expires_at: integer('expires_at'),
    token_type: text('token_type'),
    scope: text('scope'),
    id_token: text('id_token'),
    session_state: text('session_state'),
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
