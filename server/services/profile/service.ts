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
  /** F3.2 · whether solve sessions capture code snapshots. */
  snapshotCaptureEnabled: boolean;
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
      snapshotCaptureEnabled: userProfiles.snapshotCaptureEnabled,
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
    /*
     * `?? true` matches the column default, and the null it covers is a user
     * with no `user_profiles` row yet — someone who has never opened settings.
     * Defaulting them to false here would silently disable capture for every
     * user created before the column existed.
     */
    snapshotCaptureEnabled: row.snapshotCaptureEnabled ?? true,
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

/**
 * F3.2 · read just the snapshot-capture flag.
 *
 * A one-column read rather than `getProfile`, because this runs on the submit
 * path of every code execution and that function joins two tables and builds an
 * avatar appearance nobody there will look at.
 *
 * Returns the column default when the user has no `user_profiles` row — see the
 * note in `getProfile`.
 */
export async function snapshotCaptureEnabled(db: Database, userId: string): Promise<boolean> {
  const [row] = await db
    .select({ enabled: userProfiles.snapshotCaptureEnabled })
    .from(userProfiles)
    .where(eq(userProfiles.userId, userId))
    .limit(1);

  return row?.enabled ?? true;
}

/**
 * F3.2 · flip the snapshot-capture flag, and nothing else.
 *
 * Deliberately not routed through `updateProfile`. That function requires a
 * display name and a timezone, because it exists to save the profile FORM —
 * making a privacy toggle depend on a complete profile would mean a user who
 * has not filled in their name cannot turn capture off, which is precisely
 * backwards.
 *
 * Upserts, because a user who has never opened settings has no row yet and
 * their first act here must not fail.
 */
export async function setSnapshotCapture(
  db: Database,
  userId: string,
  enabled: boolean,
): Promise<void> {
  await db
    .insert(userProfiles)
    .values({ userId, snapshotCaptureEnabled: enabled })
    .onConflictDoUpdate({
      target: userProfiles.userId,
      set: { snapshotCaptureEnabled: enabled, updatedAt: new Date() },
    });
}
