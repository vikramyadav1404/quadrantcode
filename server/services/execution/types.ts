/**
 * The execution vocabulary, re-exported from the client-safe layer.
 *
 * Declared in `lib/execution/languages.ts` because the editor needs it and
 * `components/` may not import from `server/` (F0.1). Re-exported here so
 * server code reads it from the module it belongs to.
 */
export {
  EXECUTION_LANGUAGES,
  EXECUTION_VERDICTS,
  type ExecutionLanguage,
  type ExecutionVerdict,
  isExecutionLanguage,
} from '@/lib/execution/languages';
