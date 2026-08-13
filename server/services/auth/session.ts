/**
 * `getCurrentUser()` — the single read every server-side authorisation check
 * goes through (F0.3 requirement 5).
 *
 * Returns a typed `SessionUser` carrying role, verification level and
 * timezone, or `null` when anonymous. Nothing in the app reads the session
 * cookie directly.
 */
import 'server-only';
import { cache } from 'react';
import { eq } from 'drizzle-orm';
import { getDb } from '@/server/db';
import { users } from '@/server/db/schema';
import { auth } from './config';
import type { Role, SessionUser } from './rbac';
import { requireRole } from './rbac';

/**
 * `cache` dedupes within a single request, so a layout, a page and three
 * components asking for the user produce one query rather than five.
 */
export const getCurrentUser = cache(async (): Promise<SessionUser | null> => {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return null;

  const [row] = await getDb()
    .select({
      id: users.id,
      email: users.email,
      role: users.role,
      verificationLevel: users.verificationLevel,
      timezone: users.timezone,
      deletedAt: users.deletedAt,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!row || row.deletedAt !== null) return null;

  return {
    id: row.id,
    email: row.email,
    role: row.role as Role,
    verificationLevel: row.verificationLevel as 0 | 1 | 2,
    timezone: row.timezone,
  };
});

/** Convenience wrapper: load the session user and assert a role in one call. */
export async function requireCurrentUser(required: Role = 'user'): Promise<SessionUser> {
  return requireRole(await getCurrentUser(), required);
}
