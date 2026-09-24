/**
 * F4.7 · the public-profile handle, declared once.
 *
 * `HANDLE_PATTERN_SOURCE` is both the Zod rule and the database CHECK
 * (`user_profiles_handle_format`), so the two cannot drift. Lowercase letters,
 * digits and inner hyphens; 3–30 characters; no leading or trailing hyphen.
 * Lowercase-only is what makes the unique index case-insensitive without a
 * `lower()` expression index.
 */
import { z } from 'zod';

export const HANDLE_PATTERN_SOURCE = '^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$';

const HANDLE_PATTERN = new RegExp(HANDLE_PATTERN_SOURCE);

/**
 * Handles that would read as the product speaking, or collide with a route.
 * Enforced in Zod only: a reserved word is a policy that may change, and a
 * CHECK is the wrong place for a list that grows.
 */
export const RESERVED_HANDLES: ReadonlySet<string> = new Set([
  'admin',
  'administrator',
  'api',
  'app',
  'help',
  'me',
  'null',
  'quadrantcode',
  'root',
  'security',
  'settings',
  'staff',
  'support',
  'system',
  'undefined',
]);

export const handleSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(
    HANDLE_PATTERN,
    'Use 3–30 lowercase letters, digits or hyphens, not starting or ending with a hyphen',
  )
  .refine((handle) => !RESERVED_HANDLES.has(handle), 'That handle is reserved');
