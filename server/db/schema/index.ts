/**
 * Schema barrel — every table must be re-exported here or `drizzle-kit
 * generate` will not see it.
 *
 * Phase 0: identity, problem catalog, per-user tracking (F0.2) and Auth.js
 * session persistence (F0.3). Phase 1 adds CSV import jobs (F1.2), streak state
 * (F1.3), solve sessions (F1.4), reflection capture (F1.5), the analytics
 * rollups (F1.6) and the revision schedule (F2.1).
 * Later phases append their own modules; nothing here is reshaped afterwards.
 */

export * from './enums';
export * from './users';
export * from './problems';
export * from './tracking';
export * from './auth';
export * from './ingest';
export * from './streak';
export * from './session';
export * from './reflection';
export * from './analytics';
export * from './revision';
