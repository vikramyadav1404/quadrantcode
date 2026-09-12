/**
 * F1.6 · the analytics layer's public surface.
 *
 * `scoring.ts` is pure and deterministic; `rollup.ts` is the only writer to the
 * three `analytics_*_daily` tables; `dashboard.ts` only ever reads them. No
 * caller here touches a raw session, which is what keeps the page fast at six
 * months of history.
 */
export * from './dashboard';
export * from './rollup';
export * from './scoring';
