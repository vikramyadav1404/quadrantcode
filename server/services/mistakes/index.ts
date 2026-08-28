/**
 * F3.5 · the mistake-memory engine's public surface.
 *
 * `trend.ts` and `plan.ts` are pure — no clock, no database, no model.
 * `aggregate.ts` is the only writer to `mistake_patterns`, and `warning.ts` the
 * only writer to `mistake_warnings_shown`.
 */
export * from './aggregate';
export * from './plan';
export * from './trend';
export * from './warning';
