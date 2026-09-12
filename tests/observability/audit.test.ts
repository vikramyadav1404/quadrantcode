/**
 * F4.6 · audit logs are immutable, at the database.
 *
 * The criterion names UPDATE. The trigger also refuses DELETE, and this file
 * asserts both — the ticket's own sentence says "no updates, no deletes", and a
 * narrow criterion is not a reason to stop honouring the requirement beside it.
 *
 * There is a stricter policy here than on `session_events`, which allows
 * deletion behind a declared flag because a user may erase their own history.
 * **This table has no escape hatch at all**, and one of the tests below is what
 * proves that: the flag that unlocks the event log does nothing here.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { auditLogs } from '@/server/db/schema';
import { recentAudit, recordAudit } from '@/server/lib/observability';
import {
  type TestContext,
  createUser,
  expectDbRejection,
  hasTestDatabase,
  setupTestDb,
  truncateAll,
} from '../helpers/db';

const suite = hasTestDatabase ? describe : describe.skip;

suite('F4.6 · the audit log', () => {
  let ctx: TestContext;
  let actorId: string;

  beforeAll(async () => {
    ctx = await setupTestDb();
  }, 60_000);

  afterAll(async () => {
    await ctx?.close();
  });

  beforeEach(async () => {
    // `truncateAll` covers audit_logs. A DELETE here would be REFUSED by the
    // very trigger this file tests — which is how the first version of this
    // fixture leaked rows between tests.
    await truncateAll(ctx.sql);
    actorId = (await createUser(ctx.db, { email: 'admin@example.com', role: 'admin' })).id;
  });

  const write = () =>
    recordAudit(ctx.db, {
      actorId,
      action: 'problem.published',
      target: 'problem:two-sum',
      before: { status: 'draft' },
      after: { status: 'published' },
    });

  it('records an action with its diff', async () => {
    await write();

    const rows = await recentAudit(ctx.db);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.action).toBe('problem.published');
    expect(rows[0]?.diff).toMatchObject({ after: { status: 'published' } });
  });

  it('REJECTS AN UPDATE at the database', async () => {
    await write();

    await expectDbRejection(
      ctx.db.execute(sql`update audit_logs set action = 'nothing.happened'`),
      /append-only/,
    );
  });

  it('REJECTS A DELETE too', async () => {
    await write();

    await expectDbRejection(ctx.db.execute(sql`delete from audit_logs`), /append-only/);
  });

  it('POSITIVE CONTROL · an INSERT still works', async () => {
    // A table nothing can write to would pass both refusals above, and an audit
    // log nobody can append to is a worse bug than one that can be edited.
    await write();
    await write();

    expect(await recentAudit(ctx.db)).toHaveLength(2);
  });

  it("THE EVENT LOG'S PURGE FLAG DOES NOT UNLOCK THIS TABLE", async () => {
    /*
     * `session_events` allows deletion when `quadrantcode.purging` is set, because
     * a user may erase their own solve history. An audit log exists so that the
     * people with power over other people's data cannot quietly erase what they
     * did — handing them the same flag would hand them the eraser.
     */
    await write();

    await expectDbRejection(
      ctx.db.transaction(async (tx) => {
        await tx.execute(sql`select set_config('quadrantcode.purging', 'on', true)`);
        await tx.execute(sql`delete from audit_logs`);
      }),
      /append-only/,
    );
  });

  it('REDACTS PII IN THE DIFF, permanently', async () => {
    /*
     * An admin correcting a user's email must not thereby write that address
     * into a table nobody can ever edit. This is the one place redaction is
     * irreversible, so it matters more here than in a log file that rotates.
     */
    await recordAudit(ctx.db, {
      actorId,
      action: 'user.email_changed',
      target: `user:${actorId}`,
      before: { email: 'old.address@example.com' },
      after: { email: 'new.address@example.com' },
    });

    const [row] = await recentAudit(ctx.db);
    const serialised = JSON.stringify(row?.diff);

    expect(serialised).not.toMatch(/@example\.com/);
    expect(serialised).toContain('redacted');
  });

  it('survives the deletion of the admin who did it', async () => {
    // `actor_id` has no foreign key on purpose: deleting an account must not
    // cascade away the record of what that account did.
    await write();
    await ctx.sql`DELETE FROM users WHERE id = ${actorId}`;

    expect(await recentAudit(ctx.db)).toHaveLength(1);
  });

  it('refuses an empty action or target', async () => {
    await expectDbRejection(
      ctx.db.insert(auditLogs).values({ actorId, action: '', target: 'x' }),
      'audit_logs_action_not_empty',
    );
  });

  it('reads back by actor', async () => {
    await write();
    const rows = await ctx.db.select().from(auditLogs).where(eq(auditLogs.actorId, actorId));
    expect(rows).toHaveLength(1);
  });
});
