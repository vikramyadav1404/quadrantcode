/**
 * F1.5 · the reflection layer's public surface.
 *
 * Everything the user says about a solve, and nothing inferred: F3.3 writes
 * `source = 'inferred'` rows into the same tables and is a separate module for
 * a reason — a heuristic must never be able to reach the write path a person's
 * own answer uses.
 */
export * from './errors';
export * from './history';
export * from './input';
export * from './reflection';
export * from './stuck';
