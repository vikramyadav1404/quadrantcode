/**
 * Which sign-in methods an account currently has, and unlinking one.
 *
 * ## No `server-only` here, deliberately
 *
 * `session.ts` carries that directive because it reads cookies — it genuinely
 * cannot run anywhere else. These functions take `db` as a parameter and touch
 * nothing request-scoped, which puts them in the same category as
 * `phone-signin.ts`: plain service functions, and testable for that reason.
 * `server-only` throws under vitest, which does not set the `react-server`
 * export condition, so adding it would have cost this module its tests to
 * duplicate a boundary ESLint already denies by default.
 *
 * ## Why disconnecting GitHub is safe here, and would not be everywhere
 *
 * `users.email` is `NOT NULL` (F0.2) and the magic link goes to it, so every
 * account keeps a working way in no matter what is unlinked. This function does
 * not have to implement "you cannot remove your last credential", because the
 * schema means there is no last credential to remove.
 *
 * That is a fact about THIS data model, not a general one. If email ever
 * becomes nullable — the phone-first signup that F0.3b deliberately did not
 * build — this becomes a lockout and needs the check written for real.
 *
 * ## Rows, not tokens
 *
 * The listing returns whether a provider is linked and when, never the stored
 * `access_token` or `id_token`. Those columns exist because the Auth.js adapter
 * writes them; nothing in this application reads them, and a "connections" API
 * that hands them to a page is one refactor away from logging them.
 */
import { and, eq } from 'drizzle-orm';
import type { Database } from '@/server/db';
import { authAccounts } from '@/server/db/schema';

/** The providers a user can link. Email is not one — it is the account itself. */
export const LINKABLE_PROVIDERS = ['github'] as const;

export type LinkableProvider = (typeof LINKABLE_PROVIDERS)[number];

export function isLinkableProvider(value: string): value is LinkableProvider {
  return (LINKABLE_PROVIDERS as readonly string[]).includes(value);
}

export type Connection = {
  provider: LinkableProvider;
  connected: boolean;
  /** When it was linked. Null when it is not. */
  connectedAt: Date | null;
};

/** Every linkable provider, each marked connected or not. */
export async function listConnections(db: Database, userId: string): Promise<Connection[]> {
  const rows = await db
    .select({ provider: authAccounts.provider, createdAt: authAccounts.createdAt })
    .from(authAccounts)
    .where(eq(authAccounts.userId, userId));

  const linked = new Map(rows.map((row) => [row.provider, row.createdAt]));

  /*
   * Driven by LINKABLE_PROVIDERS rather than by what is in the table, so a
   * provider with no row still renders as "not connected" with a button —
   * rather than silently disappearing from the page.
   */
  return LINKABLE_PROVIDERS.map((provider) => ({
    provider,
    connected: linked.has(provider),
    connectedAt: linked.get(provider) ?? null,
  }));
}

/**
 * Unlink a provider from an account.
 *
 * Scoped by `userId` as well as provider. The id comes from the session, never
 * from the request body — deleting by provider alone would let anyone who can
 * call this unlink somebody else's GitHub, which is F4.8's IDOR rule stated as
 * a WHERE clause.
 *
 * Idempotent: disconnecting something already disconnected is a no-op, not an
 * error. A double-submitted form is not a failure worth reporting.
 */
export async function disconnectProvider(
  db: Database,
  userId: string,
  provider: LinkableProvider,
): Promise<{ removed: number }> {
  const removed = await db
    .delete(authAccounts)
    .where(and(eq(authAccounts.userId, userId), eq(authAccounts.provider, provider)))
    .returning({ provider: authAccounts.provider });

  return { removed: removed.length };
}
