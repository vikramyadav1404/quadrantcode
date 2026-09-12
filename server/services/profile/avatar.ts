/**
 * Avatar lifecycle: presign → (direct browser PUT) → confirm.
 *
 * The file NEVER passes through a Next.js route handler. Vercel caps a
 * serverless request body around 4.5MB, so proxying a 2MB upload works in dev
 * and fails unpredictably in production once base64/multipart overhead is
 * added. The two-phase presigned flow is not an optimisation, it is the only
 * shape that works.
 *
 * Confirm is where trust is established, and it trusts nothing the client said:
 *   1. the key must belong to the SESSION user
 *   2. the object must actually exist
 *   3. its real byte size must match the declaration and be within the cap
 *   4. its leading bytes must be a real image of an allowed type
 * Any failure deletes the uploaded object, so a rejected upload cannot linger
 * as an orphan or be linked to directly.
 */
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { Database } from '@/server/db';
import { userProfiles } from '@/server/db/schema';
import type { StorageProvider } from '@/server/services/storage/provider';
import {
  type AllowedImageType,
  MAGIC_PREFIX_BYTES,
  MAX_AVATAR_BYTES,
  avatarKey,
  detectImageType,
  isAllowedImageType,
  keyBelongsTo,
} from './image';

export const PRESIGN_TTL_SECONDS = 60;

export class AvatarError extends Error {
  readonly code: AvatarErrorCode;
  readonly status: number;

  constructor(code: AvatarErrorCode, message: string, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
    this.name = 'AvatarError';
  }
}

export type AvatarErrorCode =
  | 'UNSUPPORTED_TYPE'
  | 'TOO_LARGE'
  | 'NOT_UPLOADED'
  | 'SIZE_MISMATCH'
  | 'NOT_AN_IMAGE'
  | 'FORBIDDEN_KEY';

export type AvatarDeps = {
  db: Database;
  storage: StorageProvider;
  now?: () => Date;
};

/**
 * Phase A. Validates the DECLARED type and size, then signs.
 *
 * Rejecting an over-size file here means the browser never uploads it at all —
 * the F0.5 criterion "a 5MB file is rejected at presign, before any upload
 * begins". The declaration is still unverified at this point, which is exactly
 * why confirm re-checks everything.
 */
export async function presignAvatarUpload(
  deps: AvatarDeps,
  userId: string,
  declared: { contentType: string; sizeBytes: number },
): Promise<{ uploadUrl: string; key: string; expiresAt: Date }> {
  if (!isAllowedImageType(declared.contentType)) {
    throw new AvatarError('UNSUPPORTED_TYPE', 'Avatars must be a JPEG, PNG or WebP image.');
  }

  if (!Number.isFinite(declared.sizeBytes) || declared.sizeBytes <= 0) {
    throw new AvatarError('TOO_LARGE', 'That file size is not valid.');
  }

  if (declared.sizeBytes > MAX_AVATAR_BYTES) {
    throw new AvatarError(
      'TOO_LARGE',
      `Avatars must be 2MB or smaller. That file is ${(declared.sizeBytes / 1024 / 1024).toFixed(1)}MB.`,
    );
  }

  // userId comes from the caller's SESSION, never from the payload.
  const key = avatarKey(userId, randomUUID(), declared.contentType as AllowedImageType);

  const presigned = await deps.storage.createPresignedUpload({
    key,
    contentType: declared.contentType,
    maxBytes: MAX_AVATAR_BYTES,
    expiresInSeconds: PRESIGN_TTL_SECONDS,
  });

  return { uploadUrl: presigned.uploadUrl, key: presigned.key, expiresAt: presigned.expiresAt };
}

/**
 * Phase B. Verifies the uploaded object, then adopts it.
 *
 * Returns the PUBLIC URL, built server-side from the key.
 */
export async function confirmAvatarUpload(
  deps: AvatarDeps,
  userId: string,
  input: { key: string; declaredSizeBytes: number },
): Promise<{ avatarUrl: string }> {
  // 1. Ownership. Checked before touching storage so a probe for another
  //    user's key cannot even be used to test whether it exists.
  if (!keyBelongsTo(input.key, userId)) {
    throw new AvatarError('FORBIDDEN_KEY', 'That upload does not belong to you.', 403);
  }

  const object = await deps.storage.head(input.key);
  if (!object) {
    throw new AvatarError('NOT_UPLOADED', 'The upload did not complete. Try again.', 404);
  }

  /** Removes the rejected object so a failed check never leaves a live file. */
  const reject = async (code: AvatarErrorCode, message: string): Promise<never> => {
    await deps.storage.remove(input.key);
    throw new AvatarError(code, message);
  };

  // 2. Real size, not the declared one.
  if (object.size > MAX_AVATAR_BYTES) {
    await reject('TOO_LARGE', 'That image is larger than the 2MB limit.');
  }
  if (object.size !== input.declaredSizeBytes) {
    await reject(
      'SIZE_MISMATCH',
      'The uploaded file does not match what was declared. Try again.',
    );
  }

  // 3. Magic bytes. The only check an attacker cannot rename their way past.
  const prefix = await deps.storage.readPrefix(input.key, MAGIC_PREFIX_BYTES);
  if (!prefix || detectImageType(prefix) === null) {
    await reject(
      'NOT_AN_IMAGE',
      'That file is not a JPEG, PNG or WebP image, whatever it is named.',
    );
  }

  // 4. Adopt, then delete the previous object so a user holds exactly one.
  const [existing] = await deps.db
    .select({ avatarUrl: userProfiles.avatarUrl })
    .from(userProfiles)
    .where(eq(userProfiles.userId, userId))
    .limit(1);

  const avatarUrl = deps.storage.publicUrl(input.key);

  await deps.db
    .insert(userProfiles)
    .values({ userId, avatarUrl })
    .onConflictDoUpdate({ target: userProfiles.userId, set: { avatarUrl } });

  const previousKey = keyFromPublicUrl(existing?.avatarUrl ?? null);
  if (previousKey && previousKey !== input.key) {
    await deps.storage.remove(previousKey);
  }

  return { avatarUrl };
}

/** Nulls the column and deletes the object; the UI falls back to initials. */
export async function removeAvatar(deps: AvatarDeps, userId: string): Promise<void> {
  const [existing] = await deps.db
    .select({ avatarUrl: userProfiles.avatarUrl })
    .from(userProfiles)
    .where(eq(userProfiles.userId, userId))
    .limit(1);

  await deps.db
    .update(userProfiles)
    .set({ avatarUrl: null })
    .where(eq(userProfiles.userId, userId));

  const key = keyFromPublicUrl(existing?.avatarUrl ?? null);
  if (key) await deps.storage.remove(key);
}

/**
 * Recovers the storage key from a stored public URL.
 *
 * Only ever applied to values WE wrote, and it still validates the shape via
 * `keyBelongsTo`-compatible parsing — a malformed or foreign URL yields null
 * rather than a delete against an arbitrary key.
 */
export function keyFromPublicUrl(url: string | null): string | null {
  if (!url) return null;
  const match = /(avatars\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.(?:jpg|png|webp))(?:\?|$)/i.exec(url);
  return match?.[1] ?? null;
}

/**
 * Orphan cleanup: a presign with no confirm leaves a file nobody references.
 *
 * Deletes avatar objects older than `maxAgeHours` whose key is not the one
 * recorded on any profile.
 *
 * This was written expecting F2.3 to attach it to a repeating queue. **F2.3 is
 * cut**, so nothing schedules it and nothing will. It is run on demand with
 * `npm run avatars:cleanup`, which is a real limitation rather than a plan:
 * orphaned objects accumulate until someone runs it. Recorded in D17 rather
 * than left as a comment promising a queue that is not coming.
 */
export async function cleanupOrphanedAvatars(
  deps: AvatarDeps,
  options: { maxAgeHours?: number } = {},
): Promise<{ deleted: string[] }> {
  const maxAgeHours = options.maxAgeHours ?? 24;
  const now = deps.now?.() ?? new Date();
  const cutoff = new Date(now.getTime() - maxAgeHours * 60 * 60 * 1000);

  const rows = await deps.db.select({ avatarUrl: userProfiles.avatarUrl }).from(userProfiles);
  const live = new Set(
    rows
      .map((row) => keyFromPublicUrl(row.avatarUrl))
      .filter((key): key is string => key !== null),
  );

  const objects = await deps.storage.list('avatars/');
  const deleted: string[] = [];

  for (const object of objects) {
    if (live.has(object.key)) continue;
    // Age guard: an object uploaded seconds ago may be mid-confirm.
    if (object.createdAt.getTime() > cutoff.getTime()) continue;

    await deps.storage.remove(object.key);
    deleted.push(object.key);
  }

  return { deleted };
}
