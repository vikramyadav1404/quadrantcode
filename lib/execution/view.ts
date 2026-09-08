/**
 * What the editor and the result panel render, in the client-safe layer.
 *
 * `components/` may not import from `server/` (F0.1) — the same arrangement as
 * every view contract before it.
 */
import type { ExecutionLanguage, ExecutionVerdict } from './languages';
import type { ExecutionMode } from '@/lib/native/constants';

export type SafeTestResultView = {
  ordinal: number;
  visibility: 'sample' | 'visible' | 'hidden' | 'custom';
  verdict: ExecutionVerdict;
  runtimeMs: number | null;
  memoryKb: number | null;
  input?: string;
  expectedOutput?: string;
  actualOutput?: string | null;
};

export type ExecutionStatusView = 'queued' | 'running' | 'completed' | 'failed';

export type ExecutionResultView = {
  jobId: string;
  status: ExecutionStatusView;
  language: ExecutionLanguage;
  mode: ExecutionMode;
  /**
   * True when the problem is hosted elsewhere, so nothing shown is a claim
   * about correctness (C1). The panel reads this rather than re-deriving it.
   */
  scratchpad: boolean;
  verdict: ExecutionVerdict | null;
  runtimeMs: number | null;
  memoryKb: number | null;
  testsPassed: number | null;
  testsTotal: number | null;
  stdout: string | null;
  stderr: string | null;
  compileOutput: string | null;
  compilerRuntimeVersion: string | null;
  testResults: SafeTestResultView[] | null;
  /** Why the JOB failed. Never a statement about the user's code. */
  error: string | null;
};

/** Where localStorage keeps a draft. Per problem AND per language, as the ticket asks. */
export function draftKey(problemId: string, language: ExecutionLanguage): string {
  return `traceloop:draft:${problemId}:${language}`;
}

/** `120 ms` / `1.4 s`. Em dash when the provider reported nothing. */
export function formatRuntime(ms: number | null): string {
  if (ms === null) return '—';
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}

export function formatMemory(kb: number | null): string {
  if (kb === null) return '—';
  return kb < 1024 ? `${kb} KB` : `${(kb / 1024).toFixed(1)} MB`;
}

/** True while the server still owes an answer. */
export function isPending(status: ExecutionStatusView): boolean {
  return status === 'queued' || status === 'running';
}
