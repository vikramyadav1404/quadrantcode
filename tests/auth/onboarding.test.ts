/**
 * F0.3 · onboarding completion and magic-link state.
 *
 * Two things a review specifically asked for:
 *   1. that `/onboarding` and the app layout cannot disagree about "already
 *      completed" — one predicate, two call sites
 *   2. that the four link states are genuinely distinguishable, which only
 *      holds because consumption marks rather than deletes
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { authVerificationTokens, userProfiles } from '@/server/db/schema';
import {
  getProfile,
  hasCompletedProfile,
  isProfileComplete,
  updateProfile,
} from '@/server/services/profile';
import { hashLinkToken, inspectMagicLink } from '@/server/services/auth/verify-link';
import {
  type TestContext,
  createUser,
  hasTestDatabase,
  setupTestDb,
  truncateAll,
} from '../helpers/db';

const suite = hasTestDatabase ? describe : describe.skip;
const SECRET = 'test-auth-secret';

describe('F0.3 · isProfileComplete (pure)', () => {
  it.each([
    ['a real name', 'Vikram Yadav', true],
    ['a two-character name', 'Vy', true],
    ['null', null, false],
    ['empty', '', false],
    ['whitespace only', '   ', false],
    ['a tab', '\t', false],
  ])('%s → %s', (_label, displayName, expected) => {
    expect(isProfileComplete({ displayName })).toBe(expected);
  });
});

suite('F0.3 · the two completion call sites cannot drift', () => {
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

  it('hasCompletedProfile agrees with isProfileComplete for every STORABLE shape', async () => {
    // The layout calls the pure predicate on a Profile it already has; the
    // route calls the async wrapper with only a user id. If those two ever
    // disagreed, a user would bounce between /onboarding and /dashboard.
    //
    // '' and '	' are absent deliberately: the F0.5 CHECK
    // `user_profiles_display_name_length` makes them unstorable, asserted
    // below. '   ' IS storable (3 characters) and is the interesting case —
    // it satisfies the database yet must read as incomplete.
    for (const displayName of [null, '   ', 'Vy', 'Vikram Yadav']) {
      const user = await createUser(ctx.db, {
        email: `shape-${Math.random().toString(36).slice(2)}@example.com`,
      });
      await ctx.db.insert(userProfiles).values({ userId: user.id, displayName });

      const viaWrapper = await hasCompletedProfile(ctx.db, user.id);
      const viaPredicate = isProfileComplete(await getProfile(ctx.db, user.id));

      expect(viaWrapper, `displayName=${JSON.stringify(displayName)}`).toBe(viaPredicate);
    }
  });

  it('the database makes an unusable display name unstorable', async () => {
    // Why the loop above does not test '' or a lone tab: the CHECK rejects
    // them, so those profile shapes cannot reach either predicate.
    const user = await createUser(ctx.db);

    for (const displayName of ['', '	', 'x']) {
      await expect(
        ctx.db.insert(userProfiles).values({ userId: user.id, displayName }),
      ).rejects.toThrow();
    }
  });

  it('a fresh user has not completed onboarding', async () => {
    const user = await createUser(ctx.db);
    expect(await hasCompletedProfile(ctx.db, user.id)).toBe(false);
  });

  it('completing onboarding makes the route unreachable afterwards', async () => {
    const user = await createUser(ctx.db);

    await updateProfile(ctx.db, user.id, {
      displayName: 'Vikram Yadav',
      timezone: 'Asia/Kolkata',
      targetRole: 'sde_1',
    });

    expect(await hasCompletedProfile(ctx.db, user.id)).toBe(true);
    // …and the layout would therefore stop redirecting into it.
    expect(isProfileComplete(await getProfile(ctx.db, user.id))).toBe(true);
  });

  it('onboarding writes timezone where the streak engine reads it', async () => {
    const user = await createUser(ctx.db);
    await updateProfile(ctx.db, user.id, {
      displayName: 'Traveller',
      timezone: 'America/New_York',
    });

    const [row] = await ctx.sql`SELECT timezone FROM users WHERE id = ${user.id}`;
    expect(row!.timezone).toBe('America/New_York');
  });
});

suite('F0.3 · magic-link states', () => {
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

  const EMAIL = 'linkstate@example.com';

  async function issue(
    token: string,
    options: { expiresInMs?: number; consumed?: boolean } = {},
  ) {
    await ctx.db.insert(authVerificationTokens).values({
      identifier: EMAIL,
      token: hashLinkToken(token, SECRET),
      expires: new Date(Date.now() + (options.expiresInMs ?? 900_000)),
      consumedAt: options.consumed ? new Date() : null,
    });
  }

  const inspect = (token: string) =>
    inspectMagicLink(ctx.db, { token, identifier: EMAIL, secret: SECRET });

  it('a fresh link is VALID', async () => {
    await issue('fresh');
    expect((await inspect('fresh')).state).toBe('valid');
  });

  it('an aged-out link is EXPIRED, not invalid', async () => {
    await issue('stale', { expiresInMs: -1000 });
    expect((await inspect('stale')).state).toBe('expired');
  });

  it('a consumed link is USED, not invalid', async () => {
    // Only possible because consumption marks instead of deleting.
    await issue('spent', { consumed: true });
    expect((await inspect('spent')).state).toBe('used');
  });

  it('an unknown token is INVALID', async () => {
    expect((await inspect('never-issued')).state).toBe('invalid');
  });

  it('a link that was used AND has since expired reads as USED', async () => {
    // The remedy differs: "used" tells them it worked once; "expired" implies
    // it never did. Report the thing that actually happened.
    await issue('used-then-aged', { expiresInMs: -1000, consumed: true });
    expect((await inspect('used-then-aged')).state).toBe('used');
  });

  it('the same token under a different address is INVALID', async () => {
    await issue('scoped');
    const result = await inspectMagicLink(ctx.db, {
      token: 'scoped',
      identifier: 'someone-else@example.com',
      secret: SECRET,
    });
    expect(result.state).toBe('invalid');
  });

  it('a token hashed with a different secret is INVALID', async () => {
    // The stored value is sha256(token + secret); a wrong secret cannot match.
    await issue('peppered');
    const result = await inspectMagicLink(ctx.db, {
      token: 'peppered',
      identifier: EMAIL,
      secret: 'a-different-secret',
    });
    expect(result.state).toBe('invalid');
  });

  it('inspection NEVER consumes the token', async () => {
    // Redemption belongs to Auth.js's callback. If inspection consumed, a user
    // who loaded the page twice would burn their own link.
    await issue('untouched');

    await inspect('untouched');
    await inspect('untouched');

    const [row] = await ctx.sql`
      SELECT consumed_at FROM auth_verification_tokens WHERE identifier = ${EMAIL}
    `;
    expect(row!.consumed_at).toBeNull();
    expect((await inspect('untouched')).state).toBe('valid');
  });
});
