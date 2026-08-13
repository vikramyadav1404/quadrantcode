/**
 * Schema barrel — every table must be re-exported here or `drizzle-kit
 * generate` will not see it.
 *
 * Phase 0 (F0.2): identity, problem catalog, per-user tracking.
 * Later phases append their own modules; nothing here is reshaped afterwards.
 */

export * from './enums';
export * from './users';
export * from './problems';
export * from './tracking';
