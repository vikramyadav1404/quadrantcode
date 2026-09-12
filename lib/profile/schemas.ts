/**
 * Profile schemas — isomorphic, importable from a Client Component.
 *
 * In `lib/` for the same reason F1.1's catalog schemas are: the boundary rule
 * forbids a client component importing `server/**`, and a Zod schema has no
 * database access and no secrets. See docs/decisions.md.
 */
import { z } from 'zod';

export const TARGET_ROLES = ['sde_intern', 'sde_1', 'quant', 'hft', 'other'] as const;
export type TargetRole = (typeof TARGET_ROLES)[number];

/** Labels live with the values so the UI cannot invent a sixth option. */
export const TARGET_ROLE_LABELS: Record<TargetRole, string> = {
  sde_intern: 'SDE Intern',
  sde_1: 'SDE 1',
  quant: 'Quant',
  hft: 'HFT',
  other: 'Other',
};

export const displayNameSchema = z
  .string()
  .trim()
  .min(2, 'Display name must be at least 2 characters')
  .max(40, 'Display name must be 40 characters or fewer');

/**
 * Plain text only. No markdown, no HTML, no auto-linking (F0.5).
 * Control characters are stripped so a bio cannot smuggle terminal escapes or
 * bidi overrides into a log line or an admin view.
 */
export const bioSchema = z
  .string()
  .max(280, 'Bio must be 280 characters or fewer')
  // Deliberately matches control characters in order to strip them.
  .transform((value) => value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ''));

/**
 * IANA timezone. Validated against the runtime's own database rather than a
 * hardcoded list, so it cannot drift. The `users` trigger re-checks it against
 * pg_timezone_names — Zod is the good error, the trigger is the backstop.
 */
export const timezoneSchema = z
  .string()
  .min(1)
  .refine(
    (value) => {
      try {
        new Intl.DateTimeFormat('en-US', { timeZone: value });
        return true;
      } catch {
        return false;
      }
    },
    { message: 'That is not a recognised timezone' },
  );

/**
 * NOTE the absence of `avatarUrl`.
 *
 * It is deliberately NOT part of this schema. The avatar is set only by the
 * confirm endpoint, from a storage key, server-side. A client that includes
 * `avatarUrl` in a profile save has it silently dropped by the parse — which is
 * an acceptance criterion, and is why `.strip()` semantics matter here.
 */
export const updateProfileSchema = z.object({
  displayName: displayNameSchema,
  bio: bioSchema.optional(),
  targetRole: z.enum(TARGET_ROLES).optional(),
  timezone: timezoneSchema,
  publicProfileEnabled: z.boolean().default(false),
});

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

/** Phase A request. */
export const presignAvatarSchema = z.object({
  contentType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
  sizeBytes: z
    .number()
    .int()
    .positive()
    .max(2 * 1024 * 1024),
});

/** Phase B request. The key is echoed back; ownership is re-checked server-side. */
export const confirmAvatarSchema = z.object({
  key: z.string().min(1).max(256),
  sizeBytes: z
    .number()
    .int()
    .positive()
    .max(2 * 1024 * 1024),
});

/** Exactly what turning the toggle on exposes. Rendered verbatim in the UI. */
export const PUBLIC_PROFILE_DISCLOSURE =
  'Your display name, avatar, streak, total solved and topic distribution become visible at a public link. Your code, notes, mistakes and reflections never are.';
