import * as Sentry from '@sentry/nextjs';
import { scrubSentryEvent } from '@/lib/monitoring/scrub';

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  enabled: Boolean(process.env.SENTRY_DSN),
  environment: process.env.SENTRY_ENVIRONMENT ?? process.env.VERCEL_ENV ?? process.env.NODE_ENV,
  sendDefaultPii: false,
  // Session cookies reached Sentry despite the line above; see lib/monitoring/scrub.ts.
  beforeSend: (event) => scrubSentryEvent(event),
  beforeSendTransaction: (event) => scrubSentryEvent(event),
  tracesSampleRate: 0.1,
});
