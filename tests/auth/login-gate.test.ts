/**
 * F0.3 · the /login gate and its error surface.
 *
 * The bug: a browser holding somebody else's session cookie could reach /login,
 * press "Continue with GitHub", and get `OAuthAccountNotLinked` — which the page
 * then rendered nowhere, leaving the person silently stuck.
 *
 * Three things are asserted beyond the happy paths:
 *   1. the error branch OUTRANKS the redirect, because the person who needs to
 *      read the error is by definition signed in
 *   2. an unknown `?error=` is not echoed — with a positive control, since
 *      "the input does not appear in the output" passes trivially against a
 *      function that returns a constant for everything
 *   3. the redirect target cannot leave the origin, asserted HERE rather than
 *      only in return-to.test.ts, because it is this function that hands a
 *      value to `redirect()`
 */
import { describe, expect, it } from 'vitest';
import { DEMO_EMAIL, isDemoUser } from '@/lib/auth/demo';
import { type LoginGateUser, resolveLoginView } from '@/lib/auth/login-gate';
import { DEFAULT_RETURN_TO } from '@/lib/auth/return-to';
import {
  DEFAULT_SIGNIN_ERROR,
  SIGNIN_ERROR_MESSAGES,
  needsSignOut,
  signInErrorMessage,
} from '@/lib/auth/signin-error';

const ORIGIN = 'https://app.quadrantcode.test';

const NORMAL: LoginGateUser = { email: 'vikram@example.test', role: 'user' };
const ADMIN: LoginGateUser = { email: 'admin@example.test', role: 'admin' };
const DEMO: LoginGateUser = { email: DEMO_EMAIL, role: 'user' };

describe('F0.3 · isDemoUser', () => {
  it.each([
    ['the seeded address', DEMO_EMAIL, true],
    ['upper case', DEMO_EMAIL.toUpperCase(), true],
    ['padded', `  ${DEMO_EMAIL}  `, true],
    ['a real user', 'vikram@example.test', false],
    ['a lookalike domain', 'demo@quadrantcode.com', false],
    ['a lookalike local part', 'demo2@quadrantcode.local', false],
    ['empty', '', false],
    ['null', null, false],
    ['undefined', undefined, false],
  ])('%s → %s', (_label, input, expected) => {
    expect(isDemoUser(input)).toBe(expected);
  });
});

describe('F0.3 · signInErrorMessage maps rather than echoes', () => {
  it('has a distinct line for every named code', () => {
    const lines = Object.values(SIGNIN_ERROR_MESSAGES);
    expect(new Set(lines).size).toBe(lines.length);
    for (const line of lines) expect(line).not.toBe(DEFAULT_SIGNIN_ERROR);
  });

  it.each(Object.keys(SIGNIN_ERROR_MESSAGES))('%s gets its own message', (code) => {
    expect(signInErrorMessage(code)).toBe(
      SIGNIN_ERROR_MESSAGES[code as keyof typeof SIGNIN_ERROR_MESSAGES],
    );
  });

  it('tells an OAuthAccountNotLinked visitor to sign out', () => {
    expect(signInErrorMessage('OAuthAccountNotLinked')).toMatch(/sign out/i);
  });

  it.each([
    ['absent', undefined],
    ['null', null],
    ['empty string', ''],
    ['not a string', 42],
    ['an empty array', []],
  ])('%s → no banner at all', (_label, input) => {
    expect(signInErrorMessage(input)).toBeNull();
  });

  it('takes the first value when the key is repeated', () => {
    // Next hands back string[] for ?error=a&error=b.
    expect(signInErrorMessage(['AccessDenied', 'Configuration'])).toBe(
      SIGNIN_ERROR_MESSAGES.AccessDenied,
    );
  });

  /**
   * The attacker-controlled path. Anyone can send a link to /login?error=<x>,
   * so an unknown code must become OUR copy, not theirs.
   */
  const HOSTILE = [
    '<script>alert(1)</script>',
    'Your account was deleted. Call +1-555-0100.',
    'javascript:alert(1)',
    '../../etc/passwd',
    'OAuthAccountNotLinked ', // trailing space: not the known code
  ];

  it.each(HOSTILE)('an unknown code (%s) falls back to our own line', (input) => {
    expect(signInErrorMessage(input)).toBe(DEFAULT_SIGNIN_ERROR);
  });

  it('no part of an unknown code survives into the message', () => {
    for (const input of HOSTILE) {
      const message = signInErrorMessage(input);
      expect(message, input).not.toContain(input);
    }
  });

  it('the echo check has teeth (positive control)', () => {
    // A mapper that falls back to the raw code — the bug the check above
    // exists to catch. If the assertion cannot fail this, it proves nothing.
    const leaky = (code: unknown): string =>
      SIGNIN_ERROR_MESSAGES[code as keyof typeof SIGNIN_ERROR_MESSAGES] ??
      `Error: ${String(code)}`;

    const leaked = HOSTILE.filter((input) => leaky(input).includes(input));
    expect(leaked).toEqual(HOSTILE);
  });

  it('only OAuthAccountNotLinked asks for a sign-out', () => {
    expect(needsSignOut('OAuthAccountNotLinked')).toBe(true);
    expect(needsSignOut(['OAuthAccountNotLinked'])).toBe(true);
    for (const code of ['AccessDenied', 'Configuration', 'Whatever', '', undefined, null]) {
      expect(needsSignOut(code), String(code)).toBe(false);
    }
  });
});

describe('F0.3 · resolveLoginView · anonymous visitors see the form', () => {
  it('no session, no error → the plain form', () => {
    expect(resolveLoginView(null, undefined, undefined, ORIGIN)).toEqual({
      kind: 'form',
      error: null,
      offerSignOut: false,
    });
  });

  it('no session, an error → the form plus a banner', () => {
    expect(resolveLoginView(null, 'AccessDenied', undefined, ORIGIN)).toEqual({
      kind: 'form',
      error: SIGNIN_ERROR_MESSAGES.AccessDenied,
      offerSignOut: false,
    });
  });

  it('a cookie this server cannot resolve still gets the sign-out button', () => {
    // getCurrentUser() returns null when the auth_sessions row is gone, but the
    // browser still holds the cookie — and clearing it is the whole remedy.
    const view = resolveLoginView(null, 'OAuthAccountNotLinked', undefined, ORIGIN);
    expect(view).toEqual({
      kind: 'form',
      error: SIGNIN_ERROR_MESSAGES.OAuthAccountNotLinked,
      offerSignOut: true,
    });
  });
});

describe('F0.3 · resolveLoginView · a signed-in visitor is sent on', () => {
  it('redirects a normal user to the dashboard', () => {
    expect(resolveLoginView(NORMAL, undefined, undefined, ORIGIN)).toEqual({
      kind: 'redirect',
      to: DEFAULT_RETURN_TO,
    });
  });

  it('honours a valid returnTo instead of always /dashboard', () => {
    expect(resolveLoginView(NORMAL, undefined, '/problems/two-sum', ORIGIN)).toEqual({
      kind: 'redirect',
      to: '/problems/two-sum',
    });
  });

  it('still gates /admin on the role', () => {
    expect(resolveLoginView(ADMIN, undefined, '/admin', ORIGIN)).toEqual({
      kind: 'redirect',
      to: '/admin',
    });
    expect(resolveLoginView(NORMAL, undefined, '/admin', ORIGIN)).toEqual({
      kind: 'redirect',
      to: DEFAULT_RETURN_TO,
    });
  });
});

/**
 * This function is what hands a string to `next/navigation`'s `redirect()`, so
 * the open-redirect claim is asserted at THIS layer and not only against
 * `validateReturnTo`. Gating /login on a session is exactly the change that
 * could introduce one.
 */
describe('F0.3 · resolveLoginView cannot redirect off-origin', () => {
  const HOSTILE_RETURN_TO: unknown[] = [
    'https://evil.com',
    'http://evil.com/dashboard',
    'HTTPS://EVIL.COM',
    '//evil.com',
    '///evil.com',
    '/\\evil.com',
    '\\\\evil.com',
    '%2F%2Fevil.com',
    '/%2F%2Fevil.com',
    `${ORIGIN}@evil.com`,
    '//app.quadrantcode.test@evil.com',
    'javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    '/api/auth/signout?callbackUrl=https://evil.com',
    '/settings/../api/auth/signout',
    '/login',
    '/',
    42,
    null,
  ];

  it.each(HOSTILE_RETURN_TO.map((input) => [String(input), input]))(
    '%s → /dashboard, for both roles',
    (_label, input) => {
      for (const user of [NORMAL, ADMIN]) {
        const view = resolveLoginView(user, undefined, input, ORIGIN);
        expect(view, String(input)).toEqual({ kind: 'redirect', to: DEFAULT_RETURN_TO });
      }
    },
  );

  it('every emitted target is a local path on a known route', () => {
    for (const input of [...HOSTILE_RETURN_TO, '/analytics', '/revision', undefined]) {
      const view = resolveLoginView(NORMAL, undefined, input, ORIGIN);
      if (view.kind !== 'redirect') throw new Error('expected a redirect');

      expect(view.to.startsWith('/'), String(input)).toBe(true);
      expect(view.to.startsWith('//'), String(input)).toBe(false);
      // Resolving against ANY origin must stay on that origin.
      expect(new URL(view.to, 'https://other.test').origin).toBe('https://other.test');
    }
  });
});

describe('F0.3 · resolveLoginView · the demo account is not redirected', () => {
  it('shows the notice instead of sending the demo user to the dashboard', () => {
    expect(resolveLoginView(DEMO, undefined, undefined, ORIGIN)).toEqual({
      kind: 'signed-in',
      demo: true,
      error: null,
    });
  });

  it('keeps showing the notice even with a returnTo that would otherwise win', () => {
    expect(resolveLoginView(DEMO, undefined, '/problems', ORIGIN)).toEqual({
      kind: 'signed-in',
      demo: true,
      error: null,
    });
  });
});

/**
 * The regression this whole change exists for. OAuthAccountNotLinked is thrown
 * only when a valid session for a DIFFERENT user is present, so if the redirect
 * ran first the error would be unreachable by construction.
 */
describe('F0.3 · an error outranks the redirect', () => {
  it('a signed-in user with OAuthAccountNotLinked reads it instead of being bounced', () => {
    const view = resolveLoginView(NORMAL, 'OAuthAccountNotLinked', undefined, ORIGIN);
    expect(view).toEqual({
      kind: 'signed-in',
      demo: false,
      error: SIGNIN_ERROR_MESSAGES.OAuthAccountNotLinked,
    });
  });

  it('holds even when a valid returnTo is present', () => {
    const view = resolveLoginView(NORMAL, 'OAuthAccountNotLinked', '/analytics', ORIGIN);
    expect(view.kind).toBe('signed-in');
  });

  it('holds for the demo user, who sees both the notice and the error', () => {
    expect(resolveLoginView(DEMO, 'OAuthAccountNotLinked', undefined, ORIGIN)).toEqual({
      kind: 'signed-in',
      demo: true,
      error: SIGNIN_ERROR_MESSAGES.OAuthAccountNotLinked,
    });
  });

  it('holds for an unknown code too — any error is worth reading', () => {
    const view = resolveLoginView(NORMAL, 'SomethingNew', undefined, ORIGIN);
    expect(view).toEqual({ kind: 'signed-in', demo: false, error: DEFAULT_SIGNIN_ERROR });
  });

  it('no error means no exception to the redirect', () => {
    expect(resolveLoginView(NORMAL, '', undefined, ORIGIN).kind).toBe('redirect');
    expect(resolveLoginView(NORMAL, undefined, undefined, ORIGIN).kind).toBe('redirect');
  });
});
