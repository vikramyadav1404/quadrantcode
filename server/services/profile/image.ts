/**
 * Image type validation by MAGIC NUMBER.
 *
 * Neither the file extension nor the client-supplied MIME type is evidence of
 * anything — both are attacker-controlled strings. A PDF renamed `avatar.png`
 * and uploaded with `Content-Type: image/png` passes every check except this
 * one. The bytes are the only thing that cannot be renamed.
 *
 * Pure and dependency-free so it can be tested exhaustively without storage,
 * a database, or a network.
 */

export const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type AllowedImageType = (typeof ALLOWED_IMAGE_TYPES)[number];

/** Hard cap. Enforced at presign AND re-verified at confirm (F0.5). */
export const MAX_AVATAR_BYTES = 2 * 1024 * 1024;

/**
 * Bytes needed to identify every supported format.
 * WebP is the longest: `RIFF` + 4 size bytes + `WEBP` = 12.
 */
export const MAGIC_PREFIX_BYTES = 12;

export const EXTENSION_BY_TYPE: Record<AllowedImageType, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

function startsWith(bytes: Uint8Array, signature: number[], offset = 0): boolean {
  if (bytes.length < offset + signature.length) return false;
  return signature.every((byte, index) => bytes[offset + index] === byte);
}

/**
 * Identifies the real format from leading bytes, or null when it is not a
 * supported image.
 *
 *   JPEG  FF D8 FF
 *   PNG   89 50 4E 47 0D 0A 1A 0A
 *   WebP  52 49 46 46 ?? ?? ?? ?? 57 45 42 50   ("RIFF"…"WEBP")
 */
export function detectImageType(bytes: Uint8Array): AllowedImageType | null {
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg';

  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';

  // The four size bytes between the two markers are arbitrary, so both ends
  // must be checked — matching only "RIFF" would also accept WAV and AVI.
  if (
    startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) &&
    startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)
  ) {
    return 'image/webp';
  }

  return null;
}

export function isAllowedImageType(value: string): value is AllowedImageType {
  return (ALLOWED_IMAGE_TYPES as readonly string[]).includes(value);
}

/**
 * Builds the storage key.
 *
 * `userId` MUST come from the session. Taking it from the request payload
 * would let any user write into any other user's prefix — the F0.5 criterion
 * that says to test the endpoint directly rather than through the UI.
 */
export function avatarKey(userId: string, uuid: string, type: AllowedImageType): string {
  return `avatars/${userId}/${uuid}.${EXTENSION_BY_TYPE[type]}`;
}

/** Extracts the owning user id from a key, or null when the shape is wrong. */
export function ownerOfKey(key: string): string | null {
  const match = /^avatars\/([0-9a-f-]{36})\/[0-9a-f-]{36}\.(jpg|png|webp)$/i.exec(key);
  return match?.[1] ?? null;
}

/** True when `key` belongs to `userId`. The cross-user prefix guard. */
export function keyBelongsTo(key: string, userId: string): boolean {
  return ownerOfKey(key) === userId;
}
