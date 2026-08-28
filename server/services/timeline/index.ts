/**
 * F3.2 · the solve timeline's public surface.
 *
 * `snapshots.ts` is the only writer to `code_snapshots`; `retention.ts` is the
 * only module that may delete from either table, and the only one that sets the
 * flag the append-only trigger checks. `diff.ts` is pure.
 */
export * from './diff';
export * from './events';
export * from './reconstruct';
export * from './retention';
export * from './snapshots';
