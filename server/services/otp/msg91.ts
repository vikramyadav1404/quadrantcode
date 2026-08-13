/**
 * MSG91 OTP provider.
 *
 * Failures are classified as retryable (5xx, timeout, network) or terminal
 * (4xx), because the caller's fallback behaviour differs: a retryable failure
 * should be retried, a terminal one should surface a generic error to the user
 * and not burn their hourly quota again.
 */
import type { OtpDeliveryResult, OtpProvider } from './provider';
import { redactPhone } from './provider';

const ENDPOINT = 'https://control.msg91.com/api/v5/otp';
const TIMEOUT_MS = 10_000;

export type Msg91Config = {
  authKey: string;
  templateId: string;
  fetchImpl?: typeof fetch;
};

export function createMsg91OtpProvider(config: Msg91Config): OtpProvider {
  const doFetch = config.fetchImpl ?? fetch;

  return {
    name: 'msg91',
    async send(phoneNumber: string, code: string): Promise<OtpDeliveryResult> {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

      try {
        const response = await doFetch(ENDPOINT, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            authkey: config.authKey,
          },
          body: JSON.stringify({
            template_id: config.templateId,
            // MSG91 expects the number without a leading '+'.
            mobile: phoneNumber.replace(/^\+/, ''),
            otp: code,
          }),
          signal: controller.signal,
        });

        if (!response.ok) {
          return {
            ok: false,
            error: `msg91 responded ${response.status}`,
            retryable: response.status >= 500,
          };
        }

        const body = (await response.json()) as { type?: string; request_id?: string };
        if (body.type !== 'success') {
          return { ok: false, error: 'msg91 rejected the request', retryable: false };
        }

        return { ok: true, providerMessageId: body.request_id ?? 'unknown' };
      } catch (error) {
        // Never let the phone number or code reach the log via the error object.
        console.error(
          JSON.stringify({
            event: 'otp.delivery_failed',
            provider: 'msg91',
            phone: redactPhone(phoneNumber),
            reason: error instanceof Error ? error.name : 'unknown',
          }),
        );
        return { ok: false, error: 'msg91 request failed', retryable: true };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
