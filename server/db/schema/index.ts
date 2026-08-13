/**
 * Schema barrel — every table must be re-exported here or `drizzle-kit
 * generate` will not see it.
 *
 * Phase 0: identity, problem catalog, per-user tracking (F0.2) and Auth.js
 * session persistence (F0.3).
 * Later phases append their own modules; nothing here is reshaped afterwards.
 */

export * from './enums';
export * from './users';
export * from './problems';
export * from './tracking';
export * from './auth';
