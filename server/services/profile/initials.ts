/**
 * Deterministic fallback avatar — initials on a generated colour.
 *
 * No Gravatar, no external service: a third-party avatar endpoint leaks the
 * hash of a user's email to that third party on every page view.
 *
 * "Same user, same colour, always" (F0.5) means the hash must be stable across
 * processes and deploys. `Math.random`, `Date`, and JS string hashing that
 * relies on engine internals are all disqualified; this uses FNV-1a, which is
 * fully specified arithmetic.
 */

/** FNV-1a, 32-bit. Chosen for being short, stable and dependency-free. */
export function hashString(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    // 16777619, via shifts so the result stays a 32-bit unsigned integer.
    hash =
      (hash + ((hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24))) >>> 0;
  }
  return hash >>> 0;
}

/**
 * Up to two initials.
 *
 * Uses `Array.from` rather than indexing so that a name starting with an emoji
 * or an astral-plane character yields that whole character instead of half a
 * surrogate pair.
 */
export function initialsFor(displayName: string | null, email: string): string {
  const source = displayName?.trim() || email.split('@')[0] || '?';

  const words = source.split(/[\s._-]+/u).filter(Boolean);
  const letters = words
    .slice(0, 2)
    .map((word) => Array.from(word)[0] ?? '')
    .join('');

  return (letters || Array.from(source)[0] || '?').toUpperCase();
}

/**
 * Saturation and lightness are FIXED; only hue varies.
 *
 * That is what keeps every generated colour at a predictable contrast against
 * white text. Letting lightness vary would produce pale yellows that fail
 * WCAG while dark blues pass, and the failure would depend on the user's id —
 * untestable in practice. `tests/profile/initials.test.ts` asserts the worst
 * hue still clears 4.5:1.
 */
export const AVATAR_SATURATION = 62;
export const AVATAR_LIGHTNESS = 32;

export type AvatarAppearance = {
  initials: string;
  /** `hsl(...)` string, safe to inline as a style value. */
  backgroundColor: string;
  /** Always white — the fixed lightness above guarantees the contrast. */
  color: string;
  hue: number;
};

export function avatarAppearance(
  userId: string,
  displayName: string | null,
  email: string,
): AvatarAppearance {
  const hue = hashString(userId) % 360;

  return {
    initials: initialsFor(displayName, email),
    backgroundColor: `hsl(${hue} ${AVATAR_SATURATION}% ${AVATAR_LIGHTNESS}%)`,
    color: '#ffffff',
    hue,
  };
}
