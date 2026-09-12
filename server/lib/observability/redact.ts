/**
 * Removing personal data from anything on its way to a log.
 *
 * ## Why this is at the logger and not at each call site
 *
 * The ticket is explicit, and the reason is worth stating: a rule applied at
 * call sites is a rule that holds until somebody adds a call site. There are
 * dozens of `console.error(JSON.stringify(...))` in this codebase and there
 * will be more, and every one of them is a chance to forget.
 *
 * Redaction here means the guarantee is about the FUNCTION, not about the
 * discipline of everyone who ever uses it. A test greps real log output for an
 * email address and a phone number — with a control that the same check catches
 * them when redaction is removed, because "we found no emails" passes trivially
 * against a logger that emits nothing.
 *
 * ## What counts as personal
 *
 * Email addresses, phone numbers, and the keys that conventionally hold them
 * (`email`, `phone`, `password`, `token`, `secret`, `authorization`). Both,
 * because either alone leaks: a value-shaped match misses
 * `{ token: 'abc123' }`, and a key-name match misses an email embedded in a
 * free-text error message.
 *
 * ## What is deliberately NOT redacted
 *
 * `user_id`. Sentry's user context is by ID only, the ticket says so, and an
 * opaque uuid is what makes a log traceable at all. A log with no identity is
 * one you cannot follow through a request, which is the other half of this
 * ticket.
 */

/** Keys whose values never reach a log, whatever they contain. */
const SENSITIVE_KEYS = [
  'email',
  'phone',
  'phonenumber',
  'password',
  'token',
  'secret',
  'authorization',
  'cookie',
  'apikey',
  'accesstoken',
  'refreshtoken',
];

export const REDACTED = '[redacted]';

/**
 * An email, loosely.
 *
 * Deliberately broader than a validator would be. A validator's job is to
 * reject bad input; this one's is to catch anything that LOOKS like an address,
 * because a near-miss that reaches a log is still a leak.
 */
const EMAIL_PATTERN = /[\w.+-]+@[\w-]+\.[\w.-]+/g;

/**
 * A phone number: 9 or more digits, with optional separators.
 *
 * **Nine, not seven.** The first version required seven and ate every ISO
 * timestamp in the codebase — `2026-08-28` is eight digits joined by dashes,
 * which is exactly the shape being looked for. A redactor that replaces the
 * date on every log line is not over-cautious, it is broken.
 *
 * Nine still over-matches: a ten-digit order number goes too. That is the right
 * trade in this direction — an over-redacted log is harder to read, an
 * under-redacted one is a breach.
 */
const PHONE_PATTERN = /\+?\d[\d\s().-]{7,}\d/g;

/** How many digits a run must have before it is treated as a number, not a date. */
const PHONE_MIN_DIGITS = 9;

function isSensitiveKey(key: string): boolean {
  const normalised = key.toLowerCase().replace(/[_-]/g, '');
  return SENSITIVE_KEYS.some((candidate) => normalised.includes(candidate));
}

/** Redact anything that looks personal inside a string. */
export function redactString(value: string): string {
  return value.replace(EMAIL_PATTERN, REDACTED).replace(PHONE_PATTERN, (match) =>
    // The digit count is what separates a phone number from a date.
    (match.match(/\d/g) ?? []).length >= PHONE_MIN_DIGITS ? REDACTED : match,
  );
}

/**
 * Redact a whole value, recursively.
 *
 * Handles the shapes that actually reach a logger: objects, arrays, strings,
 * Errors. Depth-limited, because a cyclic structure would otherwise hang the
 * process — and a logger that can hang the process is worse than no logger.
 */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > 8) return '[too deep]';

  if (typeof value === 'string') return redactString(value);
  if (value === null || value === undefined) return value;
  if (typeof value === 'number' || typeof value === 'boolean') return value;

  if (value instanceof Error) {
    return {
      name: value.name,
      // The message often carries the input that caused it.
      message: redactString(value.message),
    };
  }

  if (Array.isArray(value)) return value.map((entry) => redact(entry, depth + 1));

  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};

    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      out[key] = isSensitiveKey(key) ? REDACTED : redact(entry, depth + 1);
    }

    return out;
  }

  // Functions, symbols, bigints. Nothing useful in a log, and stringifying a
  // closure can expose its captured scope.
  return `[${typeof value}]`;
}
