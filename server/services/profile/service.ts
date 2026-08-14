/**
 * Profile reads and writes.
 *
 * `avatarUrl` is conspicuously absent from every write path here. It is set
 * only by `confirmAvatarUpload`, from a verified storage key. A client that
 * sends `avatarUrl` in a save payload has it dropped by the Zod parse and
 * ignored here — an F0.5 acceptance criterion, and the reason this module
 * takes a parsed input type rather than `unknown`.
 */
import { eq } from 'drizzle-orm';
import type { Database } from '@/server/db';
import { userProfiles, users } from '@/server/db/schema';
import { type UpdateProfileInput, updateProfileSchema } from '@/lib/profile/schemas';
import { type AvatarAppearance, avatarAppearance } from './initials';

export class ProfileNotFoundError extends Error {
  readonly code = 'PROFILE_NOT_FOUND' as const;
  readonly status = 404 as const;
  constructor(userId: string) {
    super(`No profile for user ${userId}.`);
    this.name = 'ProfileNotFoundError';
  }
}

export type Profile = {
  userId: string;
  email: string;
  displayName: string | null;
  bio: string | null;
  targetRole: string | null;
  timezone: string;
  publicProfileEnabled: boolean;
  avatarUrl: string | null;
  /** Fallback rendering data; always present, used when avatarUrl is null. */
  appearance: AvatarAppearance;
};

export async function getProfile(db: Database, userId: string): Promise<Profile> {
  const [row] = await db
    .select({
      userId: users.id,
      email: users.email,
      timezone: users.timezone,
      displayName: userProfiles.displayName,
      bio: userProfiles.bio,
      targetRole: userProfiles.targetRole,
      publicProfileEnabled: userProfiles.publicProfileEnabled,
      avatarUrl: userProfiles.avatarUrl,
    })
    .from(users)
    .leftJoin(userProfiles, eq(userProfiles.userId, users.id))
    .where(eq(users.id, userId))
    .limit(1);

  if (!row) throw new ProfileNotFoundError(userId);

  return {
    userId: row.userId,
    email: row.email,
    displayName: row.displayName,
    bio: row.bio,
    targetRole: row.targetRole,
    timezone: row.timezone,
    publicProfileEnabled: row.publicProfileEnabled ?? false,
    avatarUrl: row.avatarUrl,
    appearance: avatarAppearance(row.userId, row.displayName, row.email),
  };
}

/**
 * Writes the profile.
 *
 * `timezone` lives on `users` (the streak engine reads it there), the rest on
 * `user_profiles` — so this is one transaction across two tables, not two
 * independent writes that can half-apply.
 */
export async function updateProfile(
  db: Database,
  userId: string,
  rawInput: unknown,
): Promise<Profile> {
  const input: UpdateProfileInput = updateProfileSchema.parse(rawInput);

  await db.transaction(async (tx) => {
    await tx.update(users).set({ timezone: input.timezone }).where(eq(users.id, userId));

    await tx
      .insert(userProfiles)
      .values({
        userId,
        displayName: input.displayName,
        bio: input.bio ?? null,
        targetRole: input.targetRole ?? null,
        publicProfileEnabled: input.publicProfileEnabled,
      })
      .onConflictDoUpdate({
        target: userProfiles.userId,
        set: {
          displayName: input.displayName,
          bio: input.bio ?? null,
          targetRole: input.targetRole ?? null,
          publicProfileEnabled: input.publicProfileEnabled,
          // avatarUrl is intentionally NOT in this set.
        },
      });
  });

  return getProfile(db, userId);
}

/**
 * THE definition of a completed profile. Everything else defers to this.
 *
 * Two callers need the answer with different data in hand: `/onboarding` has
 * only a user id, while the authenticated layout already holds a Profile it
 * loaded for the avatar. Writing the rule twice is how the two drift — so the
 * async form below is a WRAPPER over this one, not a parallel implementation.
 */
export function isProfileComplete(profile: Pick<Profile, 'displayName'>): boolean {
  return Boolean(profile.displayName?.trim());
}

/** Async form for callers holding only a user id. Defined in terms of the above. */
export async function hasCompletedProfile(db: Database, userId: string): Promise<boolean> {
  return isProfileComplete(await getProfile(db, userId));
}
