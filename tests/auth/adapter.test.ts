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

  describe('verification tokens are single-use', () => {
    it('a replayed magic link finds nothing', async () => {
      await adapter.createVerificationToken!({
        identifier: 'link@example.com',
        token: 'magic-token',
        expires: new Date(Date.now() + 900_000),
      });

      const first = await adapter.useVerificationToken!({
        identifier: 'link@example.com',
        token: 'magic-token',
      });
      expect(first?.token).toBe('magic-token');

      const replay = await adapter.useVerificationToken!({
        identifier: 'link@example.com',
        token: 'magic-token',
      });
      expect(replay).toBeNull();
    });
  });
});
