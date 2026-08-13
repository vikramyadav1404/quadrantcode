/**
 * Local-development OTP provider: prints the code to the server console.
 *
 * Guarded so it can never run in production — a silent fallback there would
 * mean nobody receives a code and the failure looks like a delivery outage.
 */
import type { OtpDeliveryResult, OtpProvider } from './provider';
import { redactPhone } from './provider';

export function createConsoleOtpProvider(nodeEnv: string): OtpProvider {
  if (nodeEnv === 'production') {
    throw new Error(
      'The console OTP provider cannot be used in production. Set MSG91_AUTH_KEY ' +
        'and MSG91_TEMPLATE_ID, or disable FEATURE_PHONE_OTP.',
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
