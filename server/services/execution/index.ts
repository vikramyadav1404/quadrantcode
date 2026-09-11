/**
 * F3.1 · the execution pipeline's public surface.
 *
 * `statemachine.ts` is pure. `provider.ts` is the seam Judge0 sits behind —
 * and today, with no `JUDGE0_URL`, the fake sits there instead and executes
 * nothing. `pipeline.ts` is the only part that reads or writes.
 */
export * from './limits';
export * from './claim';
export * from './consumer';
export * from './native';
export * from './pipeline';
export * from './provider';
export * from './queue';
export * from './sandbox';
export * from './sandbox-protocol';
export * from './statemachine';
export * from './submission-effects';
export * from './types';
export {
  JUDGE0_LANGUAGE_MATCHERS,
  Judge0Provider,
  selectJudge0Language,
  verdictForStatus,
} from './judge0';
