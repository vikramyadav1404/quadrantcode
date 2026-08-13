/**
 * Provider selection.
 *
 * Chosen by whether MSG91 credentials exist, not by NODE_ENV — a developer who
 * configures real credentials gets real SMS without a code change, and
 * production without credentials fails loudly inside the console provider
 * rather than silently dropping codes.
 */
import type { Env } from '@/lib/env';
import { createConsoleOtpProvider } from './console';
import { createMsg91OtpProvider } from './msg91';
import type { OtpProvider } from './provider';

export function resolveOtpProvider(env: Env): OtpProvider {
  if (env.MSG91_AUTH_KEY && env.MSG91_TEMPLATE_ID) {
    return createMsg91OtpProvider({
      authKey: env.MSG91_AUTH_KEY,
      templateId: env.MSG91_TEMPLATE_ID,
    });
  }
  return createConsoleOtpProvider(env.NODE_ENV);
}

export type { OtpProvider, OtpDeliveryResult } from './provider';
export { redactPhone } from './provider';
