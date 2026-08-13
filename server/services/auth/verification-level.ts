/**
 * Verification tiers (F0.3).
 *
 *   0 = email only
 *   1 = email + phone verified
 *   2 = level 1 + an active paid subscription
 *
 * `users.verification_level` is a CACHE. The truth is the function below,
 * derived from actual state; `recomputeVerificationLevel` rebuilds the column
 * from it. Anything that gates on a tier must be able to tolerate the cache
 * being stale, which is why the recompute is idempotent and cheap.
 *
 * Level 2 needs subscription state, which F4.4 owns. Until then
 * `hasActiveSubscription` is always false — declared as a dependency rather
 * than hardcoded, so F4.4 is a one-line wiring change and not a refactor.
 */
import { eq } from 'drizzle-orm';
import type { Database } from '@/server/db';
import { users } from '@/server/db/schema';

export type VerificationLevel = 0 | 1 | 2;

export type VerificationInputs = {
  emailVerifiedAt: Date | null;
  phoneVerifiedAt: Date | null;
  hasActiveSubscription: boolean;
};

/** Pure. This is the definition of a verification level; everything else caches it. */
export function computeVerificationLevel(inputs: VerificationInputs): VerificationLevel {
  const emailVerified = inputs.emailVerifiedAt !== null;
  const phoneVerified = inputs.phoneVerifiedAt !== null;

  if (emailVerified && phoneVerified && inputs.hasActiveSubscription) return 2;
  if (emailVerified && phoneVerified) return 1;
  return 0;
}

/** Resolves subscription state. Replaced by the F4.4 entitlement helper. */
export type SubscriptionLookup = (userId: string) => Promise<boolean>;

const noSubscriptions: SubscriptionLookup = () => Promise.resolve(false);

/**
 * Recomputes and persists the cached level for one user.
 * Returns the level, and whether the cache had drifted.
 */
export async function recomputeVerificationLevel(
  db: Database,
  userId: string,
  hasActiveSubscription: SubscriptionLookup = noSubscriptions,
): Promise<{ level: VerificationLevel; drifted: boolean }> {
  const [user] = await db
    .select({
      emailVerifiedAt: users.emailVerifiedAt,
      phoneVerifiedAt: users.phoneVerifiedAt,
      cached: users.verificationLevel,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!user) throw new Error(`recomputeVerificationLevel: no user ${userId}`);

  const level = computeVerificationLevel({
    emailVerifiedAt: user.emailVerifiedAt,
    phoneVerifiedAt: user.phoneVerifiedAt,
    hasActiveSubscription: await hasActiveSubscription(userId),
  });

  const drifted = user.cached !== level;
  if (drifted) {
    await db.update(users).set({ verificationLevel: level }).where(eq(users.id, userId));
  }

  return { level, drifted };
}
