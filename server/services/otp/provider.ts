/**
 * OTP delivery is behind an interface so the business rules in
 * `server/services/auth/otp.ts` never know which vendor is in play, and so
 * tests can assert on delivery without sending an SMS.
 *
 * MSG91 is the production implementation; the console provider is the default
 * everywhere else. Choosing by "is MSG91_AUTH_KEY set" rather than by
 * NODE_ENV means a developer who configures real credentials gets real SMS
 * without editing code.
 */

export type OtpDeliveryResult =
  { ok: true; providerMessageId: string } | { ok: false; error: string; retryable: boolean };

export type OtpProvider = {
  readonly name: string;
  /**
   * Delivers `code` to `phoneNumber` (E.164).
   * Implementations must never log or return the code.
   */
  send(phoneNumber: string, code: string): Promise<OtpDeliveryResult>;
};

/**
 * Redacts a phone number for logs: +919876543210 → +91******3210.
 * Every OTP log line in this codebase passes through here (security
 * requirement: "log OTP events with the phone number redacted").
 */
export function redactPhone(phoneNumber: string): string {
  if (phoneNumber.length <= 7) return '*'.repeat(phoneNumber.length);
  const head = phoneNumber.slice(0, 3);
  const tail = phoneNumber.slice(-4);
  return `${head}${'*'.repeat(Math.max(0, phoneNumber.length - 7))}${tail}`;
}
