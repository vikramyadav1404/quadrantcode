/**
 * F4.6 · observability's public surface.
 *
 * `redact.ts` is pure. `logger.ts` is the only thing that writes a log line, and
 * it redacts unconditionally — there is no path around it. `audit.ts` writes to
 * a table nothing can update or delete.
 */
export * from './alerts';
export * from './audit';
export * from './health';
export * from './logger';
export * from './redact';
export * from './request-id';
export * from './trace';
