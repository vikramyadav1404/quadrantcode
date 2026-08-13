/**
 * Identity: users, profiles and verification codes.
 */
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { userRoleEnum, verificationMethodEnum } from './enums';

export const users = pgTable(
  'users',
  {
    id: uuid().primaryKey().defaultRandom(),
    email: text().notNull(),
    emailVerifiedAt: timestamp({ withTimezone: true }),

    /** E.164, e.g. +919876543210. NULL until the F0.3 OTP flow completes. */
    phoneNumber: text(),
    phoneVerifiedAt: timestamp({ withTimezone: true }),

    /**
     * Cached tier: 0 = email only, 1 = email + phone, 2 = level 1 + active
     * paid subscription. This column is a CACHE — F0.3 ships a recompute
     * helper that rebuilds it from actual state, and the cache is never the
     * sole source of truth.
     */
    verificationLevel: smallint().notNull().default(0),

    /** IANA identifier. Validated on write by the trigger in migration 0002. */
    timezone: text().notNull().default('Asia/Kolkata'),

    role: userRoleEnum().notNull().default('user'),

    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp({ withTimezone: true }),
  },
  (table) => [
    // Serves: sign-in by email, and the "is this address taken" uniqueness rule.
    uniqueIndex('users_email_key').on(table.email),

    /**
     * "One phone number may be attached to exactly one active account, ever"
     * (F0.3). Partial so any number of users may have a NULL phone.
     */
    uniqueIndex('users_phone_number_key')
      .on(table.phoneNumber)
      .where(sql`${table.phoneNumber} is not null`),

    check('users_verification_level_range', sql`${table.verificationLevel} between 0 and 2`),
    check('users_email_lowercase', sql`${table.email} = lower(${table.email})`),
  ],
);

export const userProfiles = pgTable('user_profiles', {
  userId: uuid()
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  displayName: text(),
  avatarUrl: text(),
  bio: text(),

  /** F4.7: public profiles are OPT-IN and default OFF. */
  publicProfileEnabled: boolean().notNull().default(false),

  /** Free text, e.g. "SDE-1 at a product company". Drives track suggestions. */
  targetRole: text(),

  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

export const verificationMethods = pgTable(
  'verification_methods',
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    method: verificationMethodEnum().notNull(),

    /** The address or phone number the code was sent to. */
    identifier: text().notNull(),

    /** Hashed at rest — the plaintext code never touches the database (F0.3). */
    codeHash: text().notNull(),

    expiresAt: timestamp({ withTimezone: true }).notNull(),

    /** Verify attempts against this code; the code burns at 5. */
    attempts: integer().notNull().default(0),

    consumedAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    /**
     * Serves: "find the live code for this user and method" —
     *   SELECT * FROM verification_methods
     *   WHERE user_id = $1 AND method = $2 AND consumed_at IS NULL
     *   ORDER BY created_at DESC LIMIT 1
     * Partial, because consumed codes are only ever read for audit.
     */
    index('verification_methods_active_idx')
      .on(table.userId, table.method, table.createdAt.desc())
      .where(sql`${table.consumedAt} is null`),

    check('verification_methods_attempts_nonneg', sql`${table.attempts} >= 0`),
  ],
);
