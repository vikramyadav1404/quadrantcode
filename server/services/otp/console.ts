/**
 * Local-development OTP provider: prints the code to the server console.
 *
 * Guarded so it can never run in production — a silent fallback there would
 * mean nobody receives a code and the failure looks like a delivery outage.
 *
 * ## The escape hatch, and why it is shaped like the rate limiter's
 *
 * `next start` sets NODE_ENV=production, so the browser suite runs production
 * semantics — and phone sign-in (F0.3b) cannot be exercised there at all while
 * this throws. The alternatives were worse: pointing the tests at MSG91 means a
 * real outbound call to a vendor, and a test-only branch in the provider means
 * the path under test is not the path that ships.
 *
 * So this copies `createRateLimiter`'s answer to the identical problem: an
 * explicit, verbose, off-by-default variable that a single-process test run may
 * set. Production without MSG91 still throws unless someone has deliberately
 * written `ALLOW_CONSOLE_OTP=1`, which is not something done by accident.
 */
import type { OtpDeliveryResult, OtpProvider } from './provider';
import { redactPhone } from './provider';

export function createConsoleOtpProvider(
  nodeEnv: string,
  allowInProduction = false,
): OtpProvider {
  if (nodeEnv === 'production' && !allowInProduction) {
    throw new Error(
      'The console OTP provider cannot be used in production. Set MSG91_AUTH_KEY ' +
        'and MSG91_TEMPLATE_ID, or disable FEATURE_PHONE_OTP. ' +
        'Set ALLOW_CONSOLE_OTP=1 only for a single-process test run.',
    );
  }

  return {
    name: 'console',
    send(phoneNumber: string, code: string): Promise<OtpDeliveryResult> {
      // Intentional: this is the delivery channel in local dev.
      console.warn(`[otp:console] ${redactPhone(phoneNumber)} → code ${code}`);
      return Promise.resolve({ ok: true, providerMessageId: `console-${Date.now()}` });
    },
  };
}
