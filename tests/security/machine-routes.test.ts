/**
 * F3.1b · the two routes a PLATFORM COMPONENT calls, and nothing else.
 *
 * `/api/cron/executions/reconcile` and `/api/queues/executions` are the only
 * routes in this application that answer a caller holding no user session. That
 * makes their guards the most valuable code in the repository to get wrong, and
 * until this file existed **neither guard had a single test** — `grep` for
 * `permitsQueueConsumer` across `tests/` and `e2e/` returned nothing.
 *
 * The status codes themselves are asserted over real HTTP in
 * `e2e/machine-routes.spec.ts`, because "gets 404" is a claim about a response
 * and not about a boolean. What is asserted HERE is the layer underneath: the
 * environment contract that decides whether the guard can be reached at all.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { MessageMetadata } from '@vercel/queue';
import { describe, expect, it } from 'vitest';
import { __testing } from '@/server/env';
import {
  EXECUTION_QUEUE_RETENTION_SECONDS,
  EXECUTION_QUEUE_TOPIC,
} from '@/server/services/execution/queue';
import {
  permitsQueueConsumer,
  validExecutionDelivery,
} from '@/server/services/execution/queue-auth';

const base = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://user:password@db.example/quadrantcode',
  NEXT_PUBLIC_APP_URL: 'https://quadrantcode.example',
  AUTH_SECRET: 'a-random-production-secret-longer-than-32-characters',
} as const;

const parse = (extra: Record<string, string | undefined>): { CRON_SECRET?: string } =>
  __testing.parseServerEnv({ ...base, ...extra });

/** 32 characters, the floor the schema enforces. */
const STRONG = 'a-real-cron-secret-of-good-length';

describe('F3.1b · CRON_SECRET fails closed', () => {
  /*
   * The route reads `if (!env.CRON_SECRET || !authorized(header, env.CRON_SECRET))`.
   * Everything below is about what `env.CRON_SECRET` can possibly be, because
   * that short-circuit is what stops the comparison running against nothing.
   */

  it('is undefined when the variable is UNSET', () => {
    expect(parse({}).CRON_SECRET).toBeUndefined();
  });

  it('is undefined when the variable is an EMPTY STRING', () => {
    /*
     * The dangerous shape. An empty secret that survived as `''` would make
     * `Bearer ${secret}` equal the literal `'Bearer '` — a value any caller can
     * send. `optionalString` preprocesses '' to undefined before the schema
     * sees it, so the route's `!env.CRON_SECRET` guard catches it instead.
     */
    expect(parse({ CRON_SECRET: '' }).CRON_SECRET).toBeUndefined();
  });

  it('NEVER yields the literal string "undefined"', () => {
    /*
     * The `Bearer undefined` pattern: a template literal interpolating an unset
     * value produces a guessable credential. It cannot arise here, because the
     * only two falsy shapes above both short-circuit before any interpolation.
     * Asserted as a property rather than trusted from reading the route.
     */
    for (const value of [undefined, '']) {
      const secret = parse({ CRON_SECRET: value }).CRON_SECRET;
      expect(secret).not.toBe('undefined');
      expect(secret).toBeFalsy();
    }
  });

  it('keeps a real secret intact, so the guard is not vacuous', () => {
    // POSITIVE CONTROL. Without this the three assertions above would pass
    // against a schema that dropped CRON_SECRET entirely.
    expect(parse({ CRON_SECRET: STRONG }).CRON_SECRET).toBe(STRONG);
  });

  it('is undefined when the variable is WHITESPACE ONLY', () => {
    /*
     * `'   '` is a truthy string, so before trimming it was accepted and
     * compared byte-for-byte: a three-space credential guarding the reconciler.
     * It now collapses to undefined and the route refuses every caller.
     */
    for (const blank of ['   ', '\t', '\n', ' \t\n ']) {
      expect(parse({ CRON_SECRET: blank }).CRON_SECRET, JSON.stringify(blank)).toBeUndefined();
    }
  });

  it('TRIMS surrounding whitespace rather than comparing it', () => {
    // A value pasted out of a dashboard with a trailing newline must not become
    // a different secret from the one the caller sends.
    expect(parse({ CRON_SECRET: `  ${STRONG}\n` }).CRON_SECRET).toBe(STRONG);
  });

  it('REFUSES TO BOOT on a secret shorter than 32 characters', () => {
    /*
     * Not merely ignored — thrown. An ignored short secret would silently
     * disable the cron route and the reconciler would stop running with no
     * signal; a boot failure is the one outcome an operator cannot miss.
     */
    expect(() => parse({ CRON_SECRET: 'short' })).toThrow(/CRON_SECRET/);
    expect(() => parse({ CRON_SECRET: 'a'.repeat(31) })).toThrow(/at least 32 characters/);
    expect(parse({ CRON_SECRET: 'a'.repeat(32) }).CRON_SECRET).toBe('a'.repeat(32));
  });

  it('measures length AFTER trimming, so padding cannot fake it', () => {
    // 31 real characters padded to 40 must still be refused.
    expect(() => parse({ CRON_SECRET: `    ${'a'.repeat(31)}     ` })).toThrow(
      /at least 32 characters/,
    );
  });
});

describe('F3.1b · the queue consumer is closed on every host but Vercel', () => {
  const on = { VERCEL: '1', FEATURE_EXECUTION: 'true' };

  it('permits the consumer only with VERCEL=1 AND the execution flag', () => {
    expect(permitsQueueConsumer(on)).toBe(true);
  });

  it('refuses every other combination', () => {
    const refused: Record<string, string | undefined>[] = [
      {},
      { VERCEL: '1' },
      { FEATURE_EXECUTION: 'true' },
      { VERCEL: '0', FEATURE_EXECUTION: 'true' },
      { VERCEL: 'true', FEATURE_EXECUTION: 'true' },
      { VERCEL: '', FEATURE_EXECUTION: 'true' },
      { VERCEL: '1', FEATURE_EXECUTION: 'false' },
      { VERCEL: '1', FEATURE_EXECUTION: '' },
      { VERCEL: '1', FEATURE_EXECUTION: undefined },
    ];

    for (const env of refused) {
      expect(permitsQueueConsumer(env), JSON.stringify(env)).toBe(false);
    }
  });

  it('VERCEL is matched EXACTLY, not merely truthy', () => {
    /*
     * `'true'` and `'0'` are both truthy strings. A guard written as
     * `if (env.VERCEL)` would open the consumer on any host that sets the
     * variable to anything at all, including a developer laptop.
     */
    expect(permitsQueueConsumer({ VERCEL: 'true', FEATURE_EXECUTION: 'true' })).toBe(false);
    expect(permitsQueueConsumer({ VERCEL: '0', FEATURE_EXECUTION: 'true' })).toBe(false);
  });
});

describe('F3.1b · validExecutionDelivery is a REPLAY WINDOW, not authentication', () => {
  /**
   * Read this before trusting the name.
   *
   * `validExecutionDelivery` performs **no cryptography**. It verifies the
   * presence and plausibility of CloudEvent metadata — topic, message id,
   * delivery count, and the created/expires window — and nothing else. There is
   * no signature, no HMAC and no bearer token, and the SDK does not add one:
   * `grep -ril 'signature|verify|hmac' node_modules/@vercel/queue/dist` returns
   * nothing, and `handleCallback` fails only on "Invalid CloudEvent" /
   * "Invalid content type" — parse errors, not auth errors.
   *
   * What actually keeps the route private is the platform. From
   * https://vercel.com/changelog/vercel-queues-now-in-public-beta :
   *
   *   "Adding a trigger makes the route private: it has no public URL and only
   *    Vercel's queue infrastructure can invoke it."
   *
   * That trigger is the `queue/v2beta` entry in vercel.json, and
   * `permitsQueueConsumer` is the belt to its braces. Delete either one and a
   * well-formed forgery is accepted — which the last test here states outright
   * rather than leaving for somebody to discover.
   */
  const now = new Date('2026-09-08T10:00:00.000Z');
  const genuine = {
    topicName: EXECUTION_QUEUE_TOPIC,
    messageId: 'msg-1',
    deliveryCount: 1,
    createdAt: now,
    expiresAt: new Date(now.getTime() + EXECUTION_QUEUE_RETENTION_SECONDS * 1_000),
  } as MessageMetadata;

  const withMeta = (patch: Partial<MessageMetadata>): MessageMetadata =>
    ({ ...genuine, ...patch }) as MessageMetadata;

  it('accepts a genuine delivery, so the rejections below are not vacuous', () => {
    expect(validExecutionDelivery(genuine, now)).toBe(true);
  });

  it('rejects a delivery for ANOTHER TOPIC', () => {
    expect(validExecutionDelivery(withMeta({ topicName: 'some-other-topic' }), now)).toBe(
      false,
    );
  });

  it('rejects an EXPIRED delivery', () => {
    const expired = withMeta({ expiresAt: new Date(now.getTime() - 1) });
    expect(validExecutionDelivery(expired, now)).toBe(false);
  });

  it('rejects a delivery created in the FUTURE beyond the clock-skew allowance', () => {
    const future = withMeta({ createdAt: new Date(now.getTime() + 31_000) });
    expect(validExecutionDelivery(future, now)).toBe(false);
  });

  it('rejects a retention window LONGER than the queue can produce', () => {
    /*
     * The replay guard. A forged pair with a year-long window would otherwise
     * stay valid for a year.
     */
    const stretched = withMeta({
      expiresAt: new Date(now.getTime() + EXECUTION_QUEUE_RETENTION_SECONDS * 1_000 + 60_000),
    });
    expect(validExecutionDelivery(stretched, now)).toBe(false);
  });

  it('rejects an implausible message id or delivery count', () => {
    expect(validExecutionDelivery(withMeta({ messageId: '' }), now)).toBe(false);
    expect(validExecutionDelivery(withMeta({ messageId: 'x'.repeat(257) }), now)).toBe(false);
    expect(validExecutionDelivery(withMeta({ deliveryCount: 0 }), now)).toBe(false);
    expect(validExecutionDelivery(withMeta({ deliveryCount: -1 }), now)).toBe(false);
    expect(validExecutionDelivery(withMeta({ deliveryCount: 1.5 }), now)).toBe(false);
  });

  it('rejects MISSING timestamps rather than treating them as now', () => {
    expect(validExecutionDelivery(withMeta({ createdAt: undefined }), now)).toBe(false);
    expect(validExecutionDelivery(withMeta({ expiresAt: undefined }), now)).toBe(false);
  });

  it('DOES NOT reject a well-formed FORGERY — the platform trigger is the boundary', () => {
    /*
     * The honest test. Anyone who can reach the route can construct this
     * metadata; none of it is secret and none of it is signed. It passes.
     *
     * This is not a defect in the function — it is the function's actual
     * contract, and writing it down here is what stops a later reader from
     * treating `validExecutionDelivery` as the thing that authenticates the
     * consumer. The two controls that DO are asserted above
     * (`permitsQueueConsumer`) and in vercel.json (the queue/v2beta trigger),
     * and the live accept path is verified in a preview deployment because a
     * genuine Vercel signature cannot be minted locally.
     */
    const forged = withMeta({ messageId: 'forged-by-an-attacker', deliveryCount: 1 });
    expect(validExecutionDelivery(forged, now)).toBe(true);
  });
});

describe('F3.1b · the queue trigger in vercel.json IS the access control', () => {
  /**
   * The test that makes the paragraph above enforceable.
   *
   * Since the consumer route is not protected by a signature, the `queue/v2beta`
   * trigger is what gives it no public URL. Deleting it does not break a build,
   * does not fail a typecheck, and does not change a single line of application
   * code — it silently turns a private handler into a public one. A config file
   * is exactly where that kind of regression hides, so it is asserted here.
   */
  const config = JSON.parse(readFileSync(join(process.cwd(), 'vercel.json'), 'utf8')) as {
    functions?: Record<string, { experimentalTriggers?: { type?: string; topic?: string }[] }>;
    crons?: { path?: string; schedule?: string }[];
  };

  const CONSUMER = 'app/api/queues/executions/route.ts';

  it('POSITIVE CONTROL · vercel.json was actually read and parsed', () => {
    // An empty object would satisfy every optional lookup below.
    expect(Object.keys(config.functions ?? {}).length).toBeGreaterThan(0);
  });

  it('the consumer route declares a queue/v2beta trigger', () => {
    const triggers = config.functions?.[CONSUMER]?.experimentalTriggers ?? [];
    expect(triggers.some((trigger) => trigger.type === 'queue/v2beta')).toBe(true);
  });

  it('the trigger topic MATCHES the topic the publisher sends to', () => {
    /*
     * A drifted topic is the quiet version of this failure: the route stays
     * private, the publisher keeps succeeding, and nothing is ever delivered.
     */
    const triggers = config.functions?.[CONSUMER]?.experimentalTriggers ?? [];
    const topics = triggers.map((trigger) => trigger.topic);
    expect(topics).toContain(EXECUTION_QUEUE_TOPIC);
  });

  it('the reconciler is registered as a cron', () => {
    // The recovery path for a row committed but never published. Without the
    // cron entry an undispatched job waits forever.
    const paths = (config.crons ?? []).map((cron) => cron.path);
    expect(paths).toContain('/api/cron/executions/reconcile');
  });
});
