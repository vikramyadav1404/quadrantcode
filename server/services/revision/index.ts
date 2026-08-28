/**
 * F2.1 · the revision engine's public surface.
 *
 * `ladder.ts` and `risk.ts` are pure — no clock, no database — which is what
 * lets a ninety-day simulation run in milliseconds. `queue.ts` is the only part
 * that reads or writes.
 */
export * from './ladder';
export * from './queue';
export * from './risk';
