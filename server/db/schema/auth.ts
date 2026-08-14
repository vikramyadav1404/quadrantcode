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

/**
 * Single-use magic-link tokens.
 *
 * Consumption is a STATE CHANGE, not a delete. The stock Auth.js adapter
 * deletes the row, which destroys the only evidence separating "this link was
 * already used" from "this link never existed" — so /login/verify could not
 * tell a user which one happened, and the spec requires each state to say
 * exactly what to do next.
 *
 * Marking instead of deleting also makes single-use ATOMIC: the adapter's
 * `UPDATE ... WHERE consumed_at IS NULL ... RETURNING` cannot lose a race
 * between two simultaneous clicks, where a SELECT-then-DELETE can.
 *
 * Same pattern `verification_methods` already uses for OTP codes.
 */
export const authVerificationTokens = pgTable(
  'auth_verification_tokens',
  {
    identifier: text().notNull(),
    token: text().notNull(),
    expires: timestamp({ withTimezone: true }).notNull(),

    /** Set when the link is redeemed. NULL means still usable. */
    consumedAt: timestamp({ withTimezone: true }),

    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.identifier, table.token] }),

    /**
     * Serves the 24-hour retention sweep —
     *   DELETE FROM auth_verification_tokens WHERE created_at < now() - '24 hours'
     * Beyond that window "already used" degrades to "not valid", which is the
     * accepted residual: retaining tokens forever is worse.
     */
    index('auth_verification_tokens_created_idx').on(table.createdAt),
  ],
);
