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

/** F4.7 · the handle is someone else's. */
export class HandleTakenError extends Error {
  readonly code = 'HANDLE_TAKEN' as const;
  constructor() {
    super('That handle is already taken. Try another.');
    this.name = 'HandleTakenError';
  }
}

/** F4.7 · a public profile needs an address before it can be switched on. */
export class PublicProfileNeedsHandleError extends Error {
  readonly code = 'PUBLIC_PROFILE_NEEDS_HANDLE' as const;
  constructor() {
    super('Choose a handle to turn on your public profile.');
    this.name = 'PublicProfileNeedsHandleError';
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
  /** F4.7 · null until chosen. */
  handle: string | null;
  publicShowStreak: boolean;
  publicShowLongestStreak: boolean;
  publicShowTotalSolved: boolean;
  publicShowTopics: boolean;
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
      handle: userProfiles.handle,
      publicShowStreak: userProfiles.publicShowStreak,
      publicShowLongestStreak: userProfiles.publicShowLongestStreak,
      publicShowTotalSolved: userProfiles.publicShowTotalSolved,
      publicShowTopics: userProfiles.publicShowTopics,
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
    handle: row.handle ?? null,
    // `?? true` matches the column defaults, for a user with no profile row yet.
    publicShowStreak: row.publicShowStreak ?? true,
    publicShowLongestStreak: row.publicShowLongestStreak ?? true,
    publicShowTotalSolved: row.publicShowTotalSolved ?? true,
    publicShowTopics: row.publicShowTopics ?? true,
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

  /*
   * F4.7 · only the fields the caller actually sent. Absent means "unchanged":
   * onboarding saves without them, and writing a default would wipe a chosen
   * handle or re-show a section the user hid.
   */
  const publicFields = {
    ...(input.handle !== undefined
      ? { handle: input.handle === '' ? null : input.handle }
      : {}),
    ...(input.publicShowStreak !== undefined
      ? { publicShowStreak: input.publicShowStreak }
      : {}),
    ...(input.publicShowLongestStreak !== undefined
      ? { publicShowLongestStreak: input.publicShowLongestStreak }
      : {}),
    ...(input.publicShowTotalSolved !== undefined
      ? { publicShowTotalSolved: input.publicShowTotalSolved }
      : {}),
    ...(input.publicShowTopics !== undefined
      ? { publicShowTopics: input.publicShowTopics }
      : {}),
  };

  try {
    await db.transaction(async (tx) => {
      await tx.update(users).set({ timezone: input.timezone }).where(eq(users.id, userId));

      const [saved] = await tx
        .insert(userProfiles)
        .values({
          userId,
          displayName: input.displayName,
          bio: input.bio ?? null,
          targetRole: input.targetRole ?? null,
          publicProfileEnabled: input.publicProfileEnabled,
          ...publicFields,
        })
        .onConflictDoUpdate({
          target: userProfiles.userId,
          set: {
            displayName: input.displayName,
            bio: input.bio ?? null,
            targetRole: input.targetRole ?? null,
            publicProfileEnabled: input.publicProfileEnabled,
            ...publicFields,
            // avatarUrl is intentionally NOT in this set.
          },
        })
        .returning({
          publicProfileEnabled: userProfiles.publicProfileEnabled,
          handle: userProfiles.handle,
        });

      // Checked against the row as SAVED, so a handle stored earlier counts
      // and clearing it while leaving the profile on is refused. Throwing here
      // rolls the whole save back.
      if (saved?.publicProfileEnabled && !saved.handle) {
        throw new PublicProfileNeedsHandleError();
      }
    });
  } catch (error) {
    if (isHandleConflict(error)) throw new HandleTakenError();
    throw error;
  }

  return getProfile(db, userId);
}

/** The unique index, reached through Drizzle's wrapper (see `pgErrorOf` in the tests). */
function isHandleConflict(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current instanceof Error; depth += 1) {
    const candidate = current as Error & { code?: string; constraint_name?: string };
    if (
      candidate.code === '23505' &&
      candidate.constraint_name === 'user_profiles_handle_key'
    ) {
      return true;
    }
    current = candidate.cause;
  }
  return false;
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
