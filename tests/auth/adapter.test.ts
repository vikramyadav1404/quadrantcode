/**
 * F0.3 · Auth.js adapter.
 *
 * Two jobs:
 *
 * 1. Prove the ONE cast in `server/services/auth/adapter.ts` is safe. The
 *    adapter's TYPE requires `name` and `image` columns on `users`; its RUNTIME
 *    does not, because `createUser` does `.values(data)` and Drizzle drops keys
 *    that are not columns. If a future version of @auth/drizzle-adapter starts
 *    reading those columns, the first test here fails and the cast must be
 *    revisited — the cast is not an unchecked assumption.
 *
 * 2. Cover the three rules the wrapper adds on top of the stock adapter:
 *    lowercase email, profile row creation, session invalidation on email
 *    change, and refusing a soft-deleted account.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { authSessions, userProfiles, users } from '@/server/db/schema';
import { createTraceLoopAdapter } from '@/server/services/auth/adapter';
import { type TestContext, hasTestDatabase, setupTestDb, truncateAll } from '../helpers/db';

const suite = hasTestDatabase ? describe : describe.skip;

suite('F0.3 · Auth.js adapter (stock + three app rules)', () => {
  let ctx: TestContext;
  let adapter: ReturnType<typeof createTraceLoopAdapter>;

  beforeAll(async () => {
    ctx = await setupTestDb();
    adapter = createTraceLoopAdapter(ctx.db);
  }, 60_000);

  afterAll(async () => {
    await ctx?.close();
  });

  beforeEach(async () => {
    await truncateAll(ctx.sql);
  });

  const newUser = (overrides: Record<string, unknown> = {}) => ({
    id: crypto.randomUUID(),
    email: 'adapter@example.com',
    emailVerified: new Date(),
    name: 'Ignored Name',
    image: 'https://example.invalid/avatar.png',
    ...overrides,
  });

  describe('the usersTable cast', () => {
    it('createUser succeeds even though users has no name/image column', async () => {
      // This is the assertion that guards the cast. Auth.js passes name and
      // image; Drizzle drops them; the insert must still succeed.
      const created = await adapter.createUser!(newUser());

      expect(created.id).toBeTruthy();
      expect(created.email).toBe('adapter@example.com');
      expect(created.emailVerified).toBeInstanceOf(Date);
    });

    it('users really does not have name/image columns', async () => {
      const columns = await ctx.sql`
        SELECT column_name FROM information_schema.columns
        WHERE table_name = 'users' AND column_name IN ('name', 'image')
      `;
      // If someone "fixes" the cast by adding the columns, this fails and they
      // have to justify duplicating user_profiles.display_name / avatar_url.
      expect(columns).toHaveLength(0);
    });

    it('emailVerified maps to the email_verified_at column F0.2 specifies', async () => {
      const created = await adapter.createUser!(newUser({ email: 'mapping@example.com' }));

      const [row] = await ctx.sql`
        SELECT email_verified_at FROM users WHERE id = ${created.id}
      `;
      expect(row!.email_verified_at).not.toBeNull();

      const legacy = await ctx.sql`
        SELECT column_name FROM information_schema.columns
        WHERE table_name = 'users' AND column_name = 'email_verified'
      `;
      expect(legacy).toHaveLength(0);
    });
  });

  describe('rule 1 — emails are stored lowercase', () => {
    it('normalises a mixed-case address instead of hitting the CHECK', async () => {
      const created = await adapter.createUser!(newUser({ email: 'MixedCase@Example.COM' }));
      expect(created.email).toBe('mixedcase@example.com');

      const found = await adapter.getUserByEmail!('mixedcase@example.com');
      expect(found?.id).toBe(created.id);
    });
  });

  describe('rule 2 — every user gets a profile row', () => {
    it('creates user_profiles alongside the user', async () => {
      const created = await adapter.createUser!(newUser({ email: 'profile@example.com' }));

      const profile = await ctx.db
        .select()
        .from(userProfiles)
        .where(eq(userProfiles.userId, created.id));

      expect(profile).toHaveLength(1);
      // F4.7: public profiles are opt-in and default OFF.
      expect(profile[0]?.publicProfileEnabled).toBe(false);
    });
  });

  describe('rule 3 — sessions', () => {
    it('changing the email invalidates every existing session', async () => {
      const created = await adapter.createUser!(newUser({ email: 'rotate@example.com' }));
      await adapter.createSession!({
        sessionToken: 'token-1',
        userId: created.id,
        expires: new Date(Date.now() + 86_400_000),
      });

      expect(await ctx.db.select().from(authSessions)).toHaveLength(1);

      await adapter.updateUser!({ id: created.id, email: 'changed@example.com' });

      expect(await ctx.db.select().from(authSessions)).toHaveLength(0);
    });

    it('refuses a session belonging to a soft-deleted account', async () => {
      const created = await adapter.createUser!(newUser({ email: 'deleted@example.com' }));
      await adapter.createSession!({
        sessionToken: 'token-2',
        userId: created.id,
        expires: new Date(Date.now() + 86_400_000),
      });

      expect(await adapter.getSessionAndUser!('token-2')).not.toBeNull();

      await ctx.db.update(users).set({ deletedAt: new Date() }).where(eq(users.id, created.id));

      expect(await adapter.getSessionAndUser!('token-2')).toBeNull();
    });

    it('round-trips a session and deletes it', async () => {
      const created = await adapter.createUser!(newUser({ email: 'session@example.com' }));
      const expires = new Date(Date.now() + 86_400_000);

      await adapter.createSession!({ sessionToken: 'token-3', userId: created.id, expires });

      const loaded = await adapter.getSessionAndUser!('token-3');
      expect(loaded?.user.id).toBe(created.id);

      await adapter.deleteSession!('token-3');
      expect(await adapter.getSessionAndUser!('token-3')).toBeNull();
    });
  });

  describe('verification tokens: single-use, and the three states stay distinguishable', () => {
    const issue = (token: string, expiresInMs = 900_000) =>
      adapter.createVerificationToken!({
        identifier: 'link@example.com',
        token,
        expires: new Date(Date.now() + expiresInMs),
      });

    const use = (token: string) =>
      adapter.useVerificationToken!({ identifier: 'link@example.com', token });

    it('a replayed magic link finds nothing', async () => {
      await issue('magic-token');

      expect((await use('magic-token'))?.token).toBe('magic-token');
      expect(await use('magic-token')).toBeNull();
    });

    it('marks the row consumed rather than deleting it', async () => {
      // This is what lets /login/verify tell "already used" from "never
      // existed". A DELETE destroys that distinction.
      await issue('kept-token');
      await use('kept-token');

      const [row] = await ctx.sql`
        SELECT consumed_at FROM auth_verification_tokens WHERE token = 'kept-token'
      `;
      expect(row, 'the row must survive consumption').toBeTruthy();
      expect(row!.consumed_at).not.toBeNull();
    });

    it('leaves an unused token unconsumed', async () => {
      await issue('untouched-token');

      const [row] = await ctx.sql`
        SELECT consumed_at FROM auth_verification_tokens WHERE token = 'untouched-token'
      `;
      expect(row!.consumed_at).toBeNull();
    });

    it('returns an EXPIRED but unconsumed token, leaving expiry to Auth.js', async () => {
      // Auth.js reads `expires` off the returned row and decides. If the
      // adapter swallowed expired tokens, Auth.js would see hasInvite=false and
      // report "not valid" for a link that merely aged out.
      await issue('stale-token', -60_000);

      const row = await use('stale-token');
      expect(row).not.toBeNull();
      expect(row!.expires.getTime()).toBeLessThan(Date.now());
    });

    it('CONCURRENT redemption yields exactly one winner', async () => {
      // The reason consumption is one conditional UPDATE rather than a SELECT
      // followed by a DELETE: a read-then-write pair has a window where both
      // callers see an unconsumed row.
      await issue('raced-token');

      const results = await Promise.all(Array.from({ length: 8 }, () => use('raced-token')));

      expect(results.filter((row) => row !== null)).toHaveLength(1);
      expect(results.filter((row) => row === null)).toHaveLength(7);
    });

    it('does not consume a token belonging to a different identifier', async () => {
      await issue('shared-token');

      const wrongIdentifier = await adapter.useVerificationToken!({
        identifier: 'someone-else@example.com',
        token: 'shared-token',
      });
      expect(wrongIdentifier).toBeNull();

      // Still redeemable by its rightful owner.
      expect((await use('shared-token'))?.token).toBe('shared-token');
    });
  });
});
