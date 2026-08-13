/**
 * F0.3 · RBAC and verification tiers.
 *
 * The 403-not-redirect criterion is asserted here at the authorisation layer;
 * the rendered surface is `app/admin/layout.tsx`, which calls `forbidden()`
 * on exactly this condition.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { users } from '@/server/db/schema';
import {
  AuthenticationError,
  AuthorizationError,
  type SessionUser,
  hasRole,
  requireRole,
  requireVerificationLevel,
} from '@/server/services/auth/rbac';
import {
  computeVerificationLevel,
  recomputeVerificationLevel,
} from '@/server/services/auth/verification-level';
import {
  type TestContext,
  createUser,
  hasTestDatabase,
  setupTestDb,
  truncateAll,
} from '../helpers/db';

const suite = hasTestDatabase ? describe : describe.skip;

const sessionUser = (overrides: Partial<SessionUser> = {}): SessionUser => ({
  id: 'user-1',
  email: 'user@example.com',
  role: 'user',
  verificationLevel: 0,
  timezone: 'Asia/Kolkata',
  ...overrides,
});

describe('F0.3 · requireRole', () => {
  it('admins pass every check; users pass only the user check', () => {
    expect(hasRole('admin', 'user')).toBe(true);
    expect(hasRole('admin', 'admin')).toBe(true);
    expect(hasRole('user', 'user')).toBe(true);
    expect(hasRole('user', 'admin')).toBe(false);
  });

  it('gives an ANONYMOUS caller 401', () => {
    let thrown: unknown;
    try {
      requireRole(null, 'admin');
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(AuthenticationError);
    expect((thrown as AuthenticationError).status).toBe(401);
  });

  it('gives a SIGNED-IN non-admin 403, not a redirect', () => {
    let thrown: unknown;
    try {
      requireRole(sessionUser({ role: 'user' }), 'admin');
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(AuthorizationError);
    expect((thrown as AuthorizationError).status).toBe(403);
    // 403 rather than 401/302 is what prevents the redirect loop.
    expect((thrown as AuthorizationError).status).not.toBe(401);
  });

  it('returns the narrowed user on success', () => {
    const admin = sessionUser({ role: 'admin' });
    expect(requireRole(admin, 'admin')).toBe(admin);
  });
});

describe('F0.3 · requireVerificationLevel', () => {
  it('blocks below the required tier and explains which tier', () => {
    expect(() => requireVerificationLevel(sessionUser({ verificationLevel: 0 }), 1)).toThrow(
      /Verify your phone number/,
    );
    expect(() => requireVerificationLevel(sessionUser({ verificationLevel: 1 }), 2)).toThrow(
      /active subscription/,
    );
    expect(() =>
      requireVerificationLevel(sessionUser({ verificationLevel: 2 }), 2),
    ).not.toThrow();
  });
});

describe('F0.3 · computeVerificationLevel (pure)', () => {
  const at = new Date('2026-01-01T00:00:00Z');

  it.each([
    [{ emailVerified: null, phoneVerifiedAt: null, hasActiveSubscription: false }, 0],
    [{ emailVerified: at, phoneVerifiedAt: null, hasActiveSubscription: false }, 0],
    [{ emailVerified: at, phoneVerifiedAt: at, hasActiveSubscription: false }, 1],
    [{ emailVerified: at, phoneVerifiedAt: at, hasActiveSubscription: true }, 2],
    // A subscription without phone verification does NOT reach level 2 —
    // level 2 is defined as "level 1 plus a subscription".
    [{ emailVerified: at, phoneVerifiedAt: null, hasActiveSubscription: true }, 0],
    [{ emailVerified: null, phoneVerifiedAt: at, hasActiveSubscription: true }, 0],
  ])('%o → %i', (inputs, expected) => {
    expect(computeVerificationLevel(inputs)).toBe(expected);
  });
});

suite('F0.3 · verification level cache', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await setupTestDb();
  }, 60_000);

  afterAll(async () => {
    await ctx?.close();
  });

  beforeEach(async () => {
    await truncateAll(ctx.sql);
  });

  it('recompute matches the cached column when the cache is correct', async () => {
    const now = new Date();
    const user = await createUser(ctx.db, {
      emailVerified: now,
      phoneVerifiedAt: now,
      phoneNumber: '+919000000001',
      verificationLevel: 1,
    });

    const result = await recomputeVerificationLevel(ctx.db, user.id);
    expect(result.level).toBe(1);
    expect(result.drifted).toBe(false);
  });

  it('repairs a cache that has drifted, and is idempotent', async () => {
    const now = new Date();
    // Deliberately wrong cache: level 0 stored, but both factors are verified.
    const user = await createUser(ctx.db, {
      emailVerified: now,
      phoneVerifiedAt: now,
      phoneNumber: '+919000000002',
      verificationLevel: 0,
    });

    const first = await recomputeVerificationLevel(ctx.db, user.id);
    expect(first).toEqual({ level: 1, drifted: true });

    const [row] = await ctx.db.select().from(users).where(eq(users.id, user.id));
    expect(row?.verificationLevel).toBe(1);

    // Second run changes nothing.
    const second = await recomputeVerificationLevel(ctx.db, user.id);
    expect(second).toEqual({ level: 1, drifted: false });
  });

  it('downgrades a cache that claims more than the facts support', async () => {
    const user = await createUser(ctx.db, {
      emailVerified: new Date(),
      phoneVerifiedAt: null,
      verificationLevel: 2,
    });

    expect(await recomputeVerificationLevel(ctx.db, user.id)).toEqual({
      level: 0,
      drifted: true,
    });
  });

  it('reaches level 2 only when the subscription lookup says so', async () => {
    const now = new Date();
    const user = await createUser(ctx.db, {
      emailVerified: now,
      phoneVerifiedAt: now,
      phoneNumber: '+919000000003',
      verificationLevel: 1,
    });

    const withSubscription = await recomputeVerificationLevel(ctx.db, user.id, () =>
      Promise.resolve(true),
    );
    expect(withSubscription).toEqual({ level: 2, drifted: true });
  });
});
