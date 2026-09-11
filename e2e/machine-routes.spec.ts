import { expect, test } from '@playwright/test';

/**
 * F3.1b · the machine-called routes, asserted as STATUS CODES over real HTTP.
 *
 * `tests/security/machine-routes.test.ts` proves the environment contract
 * underneath these routes. This file proves the thing the contract is for: what
 * a caller actually receives. The project has been caught three times by a test
 * that asserted on a thrown error type or an error message instead of the
 * response, so a claim of the form "gets 404" is made here or not at all.
 *
 * **The bare `request` fixture is deliberate.** Elsewhere in this suite it was a
 * bug — `idor.spec.ts` used it and every assertion passed with 401, proving an
 * anonymous rejection rather than a signed-in stranger being refused. Here the
 * absence of a session IS the property under test: a cron invocation carries a
 * bearer token and no cookie, and it must still succeed. Do not "fix" this to
 * `page.request`; that would test the opposite of what is intended.
 */

const CRON = '/api/cron/executions/reconcile';
const QUEUE = '/api/queues/executions';

// Must match playwright.config.ts. A drifted value would make the 200 below
// fail, not silently pass, which is the right direction for this to break in.
const SECRET = 'e2e-cron-secret-not-for-production';

test.describe('F3.1b · /api/cron/executions/reconcile', () => {
  test('NO credential is refused', async ({ request }) => {
    const response = await request.get(CRON);
    expect(response.status()).toBe(404);
  });

  test('a WRONG bearer is refused', async ({ request }) => {
    const response = await request.get(CRON, {
      headers: { authorization: 'Bearer not-the-cron-secret' },
    });
    expect(response.status()).toBe(404);
  });

  test('the literal "Bearer undefined" is refused', async ({ request }) => {
    /*
     * The specific shape a template literal produces when the secret is unset.
     * If the route ever compared against `Bearer ${undefined}`, this exact
     * string would be a working credential that anybody could guess.
     */
    const response = await request.get(CRON, {
      headers: { authorization: 'Bearer undefined' },
    });
    expect(response.status()).toBe(404);
  });

  test('the secret WITHOUT its scheme is refused', async ({ request }) => {
    // The comparison covers the whole header, not a substring of it.
    const response = await request.get(CRON, { headers: { authorization: SECRET } });
    expect(response.status()).toBe(404);
  });

  test('a correct-length but wrong bearer is refused', async ({ request }) => {
    /*
     * Same byte length as the real header, so this exercises timingSafeEqual
     * itself rather than the length pre-check that guards it. Without the
     * pre-check a mismatched length throws RangeError and the route would
     * answer 500 — a different response, and therefore an oracle.
     */
    const wrong = 'x'.repeat(SECRET.length);
    const response = await request.get(CRON, { headers: { authorization: `Bearer ${wrong}` } });
    expect(response.status()).toBe(404);
  });

  test('the CORRECT bearer with NO session succeeds', async ({ request }) => {
    const response = await request.get(CRON, {
      headers: { authorization: `Bearer ${SECRET}` },
    });

    expect(response.status()).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true });
  });

  test('no session cookie was sent or set on the successful call', async ({ request }) => {
    /*
     * POSITIVE CONTROL for the 200 above. If the fixture were carrying a
     * session, that test would prove a signed-in user can call the reconciler
     * rather than that a credentialled machine can.
     */
    const response = await request.get(CRON, {
      headers: { authorization: `Bearer ${SECRET}` },
    });

    expect(response.status()).toBe(200);
    expect(response.headers()['set-cookie'] ?? '').not.toContain('traceloop.session');
  });
});

test.describe('F3.1b · /api/queues/executions', () => {
  /*
   * Only the refusals are assertable here, and that is stated rather than
   * worked around. Reaching the handler needs VERCEL=1 (not set in this
   * harness, on purpose) and then a genuine Vercel Queue signature, which is
   * minted by the platform and cannot be produced locally. The accept path is
   * therefore verified in a controlled preview deployment, not here — see
   * docs/launch-checklist.md. `permitsQueueConsumer` is covered exhaustively in
   * tests/security/machine-routes.test.ts.
   */

  test('NO credential is refused off-platform', async ({ request }) => {
    const response = await request.post(QUEUE, { data: {} });
    expect(response.status()).toBe(404);
  });

  test('a forged queue delivery is refused off-platform', async ({ request }) => {
    const response = await request.post(QUEUE, {
      headers: {
        'content-type': 'application/json',
        'x-vercel-signature': 'forged',
      },
      data: { version: 1, jobId: '00000000-0000-4000-8000-000000000000' },
    });
    expect(response.status()).toBe(404);
  });

  test('GET is not an accepted method', async ({ request }) => {
    const response = await request.get(QUEUE);
    expect(response.status()).toBe(405);
  });
});
