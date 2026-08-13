/**
 * Role-based access control (F0.3).
 *
 * `requireRole` throws a typed `AuthorizationError` carrying an HTTP status.
 * The status matters to an acceptance criterion: a signed-in non-admin hitting
 * /admin must get **403**, not a redirect to sign-in. Redirecting an
 * authenticated user to a page they are already past produces the classic
 * redirect loop, and it also leaks that /admin exists and is reachable.
 *
 * Only an ANONYMOUS request gets 401 (and, at the middleware layer, a
 * redirect to sign-in).
 */

export type Role = 'user' | 'admin';

export type SessionUser = {
  id: string;
  email: string;
  role: Role;
  verificationLevel: 0 | 1 | 2;
  timezone: string;
};

export class AuthenticationError extends Error {
  readonly status = 401 as const;
  readonly code = 'UNAUTHENTICATED' as const;
  constructor(message = 'Sign in to continue.') {
    super(message);
    this.name = 'AuthenticationError';
  }
}

export class AuthorizationError extends Error {
  readonly status = 403 as const;
  readonly code = 'FORBIDDEN' as const;
  constructor(message = 'You do not have access to this resource.') {
    super(message);
    this.name = 'AuthorizationError';
  }
}

/** Admins inherit every user permission; a plain user inherits nothing extra. */
const ROLE_RANK: Record<Role, number> = { user: 0, admin: 1 };

export function hasRole(actual: Role, required: Role): boolean {
  return ROLE_RANK[actual] >= ROLE_RANK[required];
}

/**
 * Asserts the caller is signed in and holds at least `required`.
 * Returns the narrowed user so callers do not re-null-check.
 */
export function requireRole(user: SessionUser | null, required: Role): SessionUser {
  if (!user) throw new AuthenticationError();
  if (!hasRole(user.role, required)) throw new AuthorizationError();
  return user;
}

/** Asserts a minimum verification tier — used by phone-gated and paid features. */
export function requireVerificationLevel(
  user: SessionUser | null,
  minimum: 0 | 1 | 2,
): SessionUser {
  if (!user) throw new AuthenticationError();
  if (user.verificationLevel < minimum) {
    throw new AuthorizationError(
      minimum >= 2
        ? 'This feature needs an active subscription.'
        : 'Verify your phone number to use this feature.',
    );
  }
  return user;
}
