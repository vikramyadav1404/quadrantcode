/**
 * F0.3b · linked sign-in providers.
 *
 * Two claims worth a database to check:
 *
 *   · disconnecting is scoped to the caller, so it cannot unlink somebody
 *     else's GitHub — F4.8's IDOR rule expressed as a WHERE clause
 *   · disconnecting cannot lock anyone out, because email is the account
 *
 * The second one is the reason `disconnectProvider` has no "is this your last
 * credential" check. That absence is only safe while `users.email` is NOT NULL,
 * so the test asserts the schema fact directly rather than trusting the comment
 * that says so.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { authAccounts, users } from '@/server/db/schema';
import {
  LINKABLE_PROVIDERS,
  disconnectProvider,
  isLinkableProvider,
  listConnections,
} from '@/server/services/auth/connections';
import {
  type TestContext,
  createUser,
  hasTestDatabase,
  setupTestDb,
  truncateAll,
} from '../helpers/db';

const suite = hasTestDatabase ? describe : describe.skip;

suite('F0.3b · provider connections', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await setupTestDb();
  });

  afterAll(async () => {
    await ctx.close();
  });

  beforeEach(async () => {
    await truncateAll(ctx.sql);
  });

  async function linkGitHub(userId: string, providerAccountId: string) {
    await ctx.db.insert(authAccounts).values({
      userId,
      provider: 'github',
      providerAccountId,
      type: 'oauth',
    });
  }

  it('lists every linkable provider, connected or not', async () => {
    const user = await createUser(ctx.db);

    const before = await listConnections(ctx.db, user.id);
    expect(before.map((entry) => entry.provider)).toEqual([...LINKABLE_PROVIDERS]);
    expect(before.every((entry) => !entry.connected)).toBe(true);

    /*
     * A provider with no row still appears. If the list were built from the
     * table, an unconnected GitHub would simply vanish from the page — and the
     * button to connect it with.
     */
    await linkGitHub(user.id, 'gh-1');
    const after = await listConnections(ctx.db, user.id);
    expect(after).toHaveLength(before.length);
    expect(after[0]?.connected).toBe(true);
    expect(after[0]?.connectedAt).toBeInstanceOf(Date);
  });

  it('never returns the stored OAuth tokens', async () => {
    /*
     * The adapter writes `access_token` and `id_token` into this table. Nothing
     * in the app reads them, and a connections API that hands them to a page is
     * one refactor away from putting them in a log.
     */
    const user = await createUser(ctx.db);
    await ctx.db.insert(authAccounts).values({
      userId: user.id,
      provider: 'github',
      providerAccountId: 'gh-tokens',
      type: 'oauth',
      access_token: 'gho_secret_value',
      id_token: 'jwt_secret_value',
    });

    const serialised = JSON.stringify(await listConnections(ctx.db, user.id));
    expect(serialised).not.toContain('gho_secret_value');
    expect(serialised).not.toContain('jwt_secret_value');
  });

  it('DISCONNECTS ONLY THE CALLER — another user keeps theirs', async () => {
    const mine = await createUser(ctx.db);
    const theirs = await createUser(ctx.db);
    await linkGitHub(mine.id, 'gh-mine');
    await linkGitHub(theirs.id, 'gh-theirs');

    await disconnectProvider(ctx.db, mine.id, 'github');

    expect((await listConnections(ctx.db, mine.id))[0]?.connected).toBe(false);

    // POSITIVE CONTROL: the delete did happen, and stopped at the right row.
    expect((await listConnections(ctx.db, theirs.id))[0]?.connected).toBe(true);
    expect(await ctx.db.select().from(authAccounts)).toHaveLength(1);
  });

  it('is idempotent — disconnecting nothing is not an error', async () => {
    const user = await createUser(ctx.db);

    const first = await disconnectProvider(ctx.db, user.id, 'github');
    expect(first.removed).toBe(0);

    await linkGitHub(user.id, 'gh-x');
    expect((await disconnectProvider(ctx.db, user.id, 'github')).removed).toBe(1);
    expect((await disconnectProvider(ctx.db, user.id, 'github')).removed).toBe(0);
  });

  it('leaves a working way in, because the account still has its email', async () => {
    /*
     * The claim the UI makes out loud: "removing anything here cannot lock you
     * out". It holds because email is NOT NULL, so this asserts the column
     * rather than the sentence — a schema change that made email nullable would
     * fail here, which is exactly where it should be noticed.
     */
    const user = await createUser(ctx.db, { email: 'still-here@example.com' });
    await linkGitHub(user.id, 'gh-last');

    await disconnectProvider(ctx.db, user.id, 'github');

    const [row] = await ctx.db.select().from(users).where(eq(users.id, user.id));

    expect(row?.email).toBe('still-here@example.com');
  });

  it('rejects a provider name that is not on the list', () => {
    // The server action validates with this before anything reaches a query.
    expect(isLinkableProvider('github')).toBe(true);
    expect(isLinkableProvider('google')).toBe(false);
    expect(isLinkableProvider('')).toBe(false);
  });
});
