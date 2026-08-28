/**
 * F3.3 · the stuck-inference engine's public surface.
 *
 * `signals.ts` and `rank.ts` are pure — no clock, no database, no network — and
 * `persist.ts` is the only module that writes inferred rows into
 * `stuck_points`. Nothing here imports an AI gateway, and a test proves that
 * check can see one when it is there.
 */
export * from './persist';
export * from './session';
export * from './rank';
export * from './signals';
export * from './types';
