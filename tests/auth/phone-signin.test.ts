/**
 * F0.3b · signing in with a phone number, and the thing that must not leak.
 *
 * The whole point of this flow is that the server behaves DIFFERENTLY for a
 * registered number and an unregistered one — it sends a code to the first and
 * not the second — while SAYING the same thing to both.
 *
 * A test that only checks the response is therefore worth very little: it would
 * pass just as well against a version that never sends anything to anyone. So
 * every enumeration test below asserts both halves at once:
 *
 *   the responses are identical  AND  the side effects are not
 *
 * The second half is the positive control, and it is not optional. Without it
 * this file is the "boundary test scoped to three directories" all over again.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { authSessions, users, verificationMethods } from '@/server/db/schema';
import { OTP_MAX_REQUESTS_PER_HOUR, OTP_MAX_VERIFY_ATTEMPTS } from '@/server/services/auth/otp';
import { completePhoneSignIn, startPhoneSignIn } from '@/server/services/auth/phone-signin';
import type { OtpProvider } from '@/server/services/otp/provider';
import {
  type TestContext,
  createUser,
  hasTestDatabase,
  setupTestDb,
  truncateAll,
} from '../helpers/db';

const suite = hasTestDatabase ? describe : describe.skip;

const SECRET = 'test-pepper';
const REGISTERED = '+919876543210';
const UNREGISTERED = '+919999900000';
const UNVERIFIED = '+919812345678';

/** Captures delivered codes so a test can submit the real one. */
function recordingProvider() {
  const sent: Array<{ phoneNumber: string; code: string }> = [];
  const provider: OtpProvider = {
    name: 'recording',
    send(phoneNumber, code) {
      sent.push({ phoneNumber, code });
      return Promise.resolve({ ok: true as const, providerMessageId: `test-${sent.length}` });
    },
  };
  return { provider, sent, last: () => sent.at(-1)?.code ?? '' };
}

suite('F0.3b · phone sign-in', () => {
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

  /** A user whose phone is verified — the only kind that can sign in this way. */
  async function seedVerifiedUser(phoneNumber = REGISTERED) {
    return createUser(ctx.db, {
      phoneNumber,
      phoneVerifiedAt: new Date(),
      emailVerified: new Date(),
    });
  }

  describe('the request never says whether a number is registered', () => {
    it('answers a registered and an unregistered number identically', async () => {
      const { provider } = recordingProvider();
      await seedVerifiedUser();

      const known = await startPhoneSignIn(
        { db: ctx.db, provider, secret: SECRET },
        REGISTERED,
      );
      const unknown = await startPhoneSignIn(
        { db: ctx.db, provider, secret: SECRET },
        UNREGISTERED,
      );

      // Not "both are truthy" — the same value, so a future field cannot differ.
      expect(known).toEqual(unknown);
      expect(known).toEqual({ sent: true });
    });

    it('POSITIVE CONTROL · the two cases really are different underneath', async () => {
      /*
       * This is the assertion that gives the one above its meaning.
       *
       * If no code were ever sent to anybody, the responses would match and the
       * test would pass while the feature did nothing. So: exactly one SMS, to
       * the registered number, and exactly one code row in the database.
       */
      const { provider, sent } = recordingProvider();
      const user = await seedVerifiedUser();

      await startPhoneSignIn({ db: ctx.db, provider, secret: SECRET }, REGISTERED);
      await startPhoneSignIn({ db: ctx.db, provider, secret: SECRET }, UNREGISTERED);

      expect(sent.map((message) => message.phoneNumber)).toEqual([REGISTERED]);

      const rows = await ctx.db
        .select()
        .from(verificationMethods)
        .where(eq(verificationMethods.userId, user.id));
      expect(rows).toHaveLength(1);
    });

    it('treats an UNVERIFIED number as unregistered, and sends nothing', async () => {
      /*
       * Someone can type a number they do not own into their settings and never
       * confirm it. If that were enough to sign in, the flow would be a way to
       * take over an account by claiming a number.
       */
      const { provider, sent } = recordingProvider();
      await createUser(ctx.db, { phoneNumber: UNVERIFIED, phoneVerifiedAt: null });

      const outcome = await startPhoneSignIn(
        { db: ctx.db, provider, secret: SECRET },
        UNVERIFIED,
      );

      expect(outcome).toEqual({ sent: true });
      expect(sent).toEqual([]);
    });

    it('answers the same when the number is rate limited by the OTP service', async () => {
      /*
       * "You are being rate limited" is itself a statement that the number
       * exists. The hourly cap is three, so the fourth request is refused
       * INSIDE the service — and must still come back looking like the first.
       */
      const { provider, sent } = recordingProvider();
      await seedVerifiedUser();
      const deps = { db: ctx.db, provider, secret: SECRET };

      const first = await startPhoneSignIn(deps, REGISTERED);
      await startPhoneSignIn(deps, REGISTERED);
      await startPhoneSignIn(deps, REGISTERED);
      const refused = await startPhoneSignIn(deps, REGISTERED);

      expect(refused).toEqual(first);

      /*
       * AND the limit actually engaged.
       *
       * Without this the assertion above passes against a service that never
       * rate limits anything — four identical successes also satisfy "the
       * fourth looks like the first". Three codes went out, the fourth did not,
       * and the caller cannot tell.
       */
      expect(sent).toHaveLength(OTP_MAX_REQUESTS_PER_HOUR);
    });

    it('DOES report an invalid number, because that is about the string typed', async () => {
      const { provider, sent } = recordingProvider();

      const outcome = await startPhoneSignIn(
        { db: ctx.db, provider, secret: SECRET },
        'not-a-phone',
      );

      expect(outcome).toEqual({ sent: false, reason: 'invalid_phone' });
      expect(sent).toEqual([]);
    });
  });

  describe('verifying a code', () => {
    it('creates a real session row, and returns a token that points at it', async () => {
      const { provider, last } = recordingProvider();
      const user = await seedVerifiedUser();
      const deps = { db: ctx.db, provider, secret: SECRET };

      await startPhoneSignIn(deps, REGISTERED);
      const outcome = await completePhoneSignIn(deps, REGISTERED, last());

      expect(outcome.ok).toBe(true);
      if (!outcome.ok) return;

      /*
       * The row is what makes this a session rather than a bearer string: it is
       * revocable, it expires, and "sign out everywhere" can find it. A token
       * with no row would still let the holder in and could never be taken away.
       */
      const [row] = await ctx.db
        .select()
        .from(authSessions)
        .where(eq(authSessions.sessionToken, outcome.sessionToken));

      expect(row?.userId).toBe(user.id);
      expect(row?.expires.getTime()).toBe(outcome.expires.getTime());
    });

    it('gives one message for a wrong code, an unknown number and a bad shape', async () => {
      const { provider, last } = recordingProvider();
      await seedVerifiedUser();
      const deps = { db: ctx.db, provider, secret: SECRET };
      await startPhoneSignIn(deps, REGISTERED);

      const wrongCode = await completePhoneSignIn(deps, REGISTERED, '000000');
      const unknownNumber = await completePhoneSignIn(deps, UNREGISTERED, last());
      const badNumber = await completePhoneSignIn(deps, 'not-a-phone', last());

      expect(wrongCode).toEqual(unknownNumber);
      expect(wrongCode).toEqual(badNumber);
      expect(wrongCode.ok).toBe(false);
    });

    it('POSITIVE CONTROL · the right code for the right number DOES work', async () => {
      // Otherwise the test above passes against a flow that rejects everything.
      const { provider, last } = recordingProvider();
      await seedVerifiedUser();
      const deps = { db: ctx.db, provider, secret: SECRET };

      await startPhoneSignIn(deps, REGISTERED);
      expect((await completePhoneSignIn(deps, REGISTERED, last())).ok).toBe(true);
    });

    it('a code issued for one number cannot sign in another', async () => {
      /*
       * Two verified users, two codes outstanding. Submitting A's code against
       * B's number must fail — the code is scoped to the user it was issued to,
       * not to "any code currently valid".
       */
      const { provider, sent } = recordingProvider();
      await seedVerifiedUser(REGISTERED);
      await createUser(ctx.db, {
        phoneNumber: UNVERIFIED,
        phoneVerifiedAt: new Date(),
        emailVerified: new Date(),
      });
      const deps = { db: ctx.db, provider, secret: SECRET };

      await startPhoneSignIn(deps, REGISTERED);
      await startPhoneSignIn(deps, UNVERIFIED);

      const codeForFirst = sent.find((m) => m.phoneNumber === REGISTERED)!.code;
      const crossed = await completePhoneSignIn(deps, UNVERIFIED, codeForFirst);

      expect(crossed.ok).toBe(false);
      expect(await ctx.db.select().from(authSessions)).toHaveLength(0);
    });

    it('locks out after the attempt limit rather than allowing unlimited guesses', async () => {
      const { provider, last } = recordingProvider();
      await seedVerifiedUser();
      const deps = { db: ctx.db, provider, secret: SECRET };
      await startPhoneSignIn(deps, REGISTERED);

      for (let attempt = 0; attempt < OTP_MAX_VERIFY_ATTEMPTS; attempt += 1) {
        await completePhoneSignIn(deps, REGISTERED, '000000');
      }

      // The REAL code, after the lockout. Still refused, and still no session.
      const afterLockout = await completePhoneSignIn(deps, REGISTERED, last());
      expect(afterLockout.ok).toBe(false);
      expect(await ctx.db.select().from(authSessions)).toHaveLength(0);
    });

    it('a soft-deleted user cannot sign in with their old number', async () => {
      const { provider, sent } = recordingProvider();
      const user = await seedVerifiedUser();
      const deps = { db: ctx.db, provider, secret: SECRET };

      await startPhoneSignIn(deps, REGISTERED);
      const code = sent[0]!.code;

      await ctx.db.update(users).set({ deletedAt: new Date() }).where(eq(users.id, user.id));

      expect((await completePhoneSignIn(deps, REGISTERED, code)).ok).toBe(false);
    });
  });
});
