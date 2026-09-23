/**
 * F1.4 · the solve-session engine's public surface.
 *
 * `lifecycle.ts` is the only writer to `solve_sessions`; `events.ts` is the only
 * writer to `session_events` and only ever appends. Everything in `duration.ts`
 * and `state.ts` is pure and testable without a database.
 */
export * from './duration';
export * from './errors';
export * from './events';
export * from './lifecycle';
export * from './signals';
export * from './state';
export * from './sweep';
