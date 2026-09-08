'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { CodeEditor } from '@/components/editor/CodeEditor';
import { RunOutput } from '@/components/editor/RunOutput';
import { DifficultyPill } from '@/components/solve/DifficultyPill';
import {
  EXECUTION_LANGUAGES,
  EXECUTION_LANGUAGE_LABELS,
  isExecutionLanguage,
  type ExecutionLanguage,
} from '@/lib/execution/languages';
import { isPending, type ExecutionResultView } from '@/lib/execution/view';
import {
  finalizeAssessmentAction,
  runAssessmentAnswerAction,
  switchAssessmentQuestionAction,
} from './actions';

type WorkspaceProps = {
  attempt: {
    id: string;
    status: 'in_progress' | 'submitted' | 'auto_submitted' | 'expired';
    expiresAt: string;
    activeQuestionId: string | null;
    score: number;
    maximumScore: number;
  };
  paper: { title: string; instructions: string };
  questions: Array<{
    id: string;
    ordinal: number;
    marks: number;
    problemId: string;
    slug: string;
    title: string;
    difficulty: 'easy' | 'medium' | 'hard';
    statement: string | null;
  }>;
  answers: Array<{
    paperQuestionId: string;
    language: ExecutionLanguage;
    source: string;
    verdict: string | null;
    marksAwarded: number;
    timeSpentSeconds: number;
  }>;
  templates: Array<{
    problemId: string;
    language: ExecutionLanguage;
    starterCode: string;
  }>;
};

export function AssessmentWorkspace(props: WorkspaceProps) {
  const router = useRouter();
  const active = props.attempt.status === 'in_progress';
  const [questionId, setQuestionId] = useState(
    props.attempt.activeQuestionId ?? props.questions[0]?.id ?? '',
  );
  const question =
    props.questions.find((item) => item.id === questionId) ?? props.questions[0]!;
  const answer = props.answers.find((item) => item.paperQuestionId === question.id);
  const [language, setLanguage] = useState<ExecutionLanguage>(answer?.language ?? 'cpp17');
  const starters = useMemo(
    () =>
      Object.fromEntries(
        props.templates
          .filter((template) => template.problemId === question.problemId)
          .map((template) => [template.language, template.starterCode]),
      ) as Partial<Record<ExecutionLanguage, string>>,
    [props.templates, question.problemId],
  );
  const [source, setSource] = useState(answer?.source ?? starters[language] ?? '');
  const [result, setResult] = useState<ExecutionResultView | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [remaining, setRemaining] = useState(() => secondsUntil(props.attempt.expiresAt));
  const autoSubmitted = useRef(false);

  useEffect(() => {
    setLanguage(answer?.language ?? 'cpp17');
    setSource(answer?.source ?? starters[answer?.language ?? 'cpp17'] ?? '');
    setResult(null);
  }, [questionId, answer?.language, answer?.source, starters]);

  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => {
      const next = secondsUntil(props.attempt.expiresAt);
      setRemaining(next);
      if (next === 0 && !autoSubmitted.current) {
        autoSubmitted.current = true;
        void finalizeAssessmentAction(props.attempt.id).then(() => router.refresh());
      }
    }, 500);
    return () => clearInterval(timer);
  }, [active, props.attempt.expiresAt, props.attempt.id, router]);

  async function switchQuestion(nextId: string) {
    if (!active || nextId === questionId) return;
    setBusy(true);
    const switched = await switchAssessmentQuestionAction({
      attemptId: props.attempt.id,
      paperQuestionId: nextId,
    });
    setBusy(false);
    if (!switched.ok) return setMessage(switched.message);
    setQuestionId(nextId);
    router.refresh();
  }

  async function execute(submit: boolean) {
    setBusy(true);
    setMessage(null);
    setResult(null);
    const response = await runAssessmentAnswerAction({
      attemptId: props.attempt.id,
      paperQuestionId: question.id,
      language,
      source,
      submit,
    });
    if (!response.ok || !response.jobId) {
      setBusy(false);
      setMessage(response.ok ? 'No execution job was created.' : response.message);
      return;
    }
    setResult(queuedResult(response.jobId, language, submit ? 'assessment' : 'run'));
    await poll(response.jobId);
  }

  async function poll(jobId: string) {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 700));
      const response = await fetch(`/api/execution/${jobId}`, { cache: 'no-store' });
      if (!response.ok) {
        setMessage('Lost contact with the execution job.');
        setBusy(false);
        return;
      }
      const next = (await response.json()) as ExecutionResultView;
      setResult(next);
      if (!isPending(next.status)) {
        setBusy(false);
        router.refresh();
        return;
      }
    }
    setMessage('The execution stopped responding.');
    setBusy(false);
  }

  async function finish() {
    setBusy(true);
    const response = await finalizeAssessmentAction(props.attempt.id);
    setBusy(false);
    if (!response.ok) return setMessage(response.message);
    router.refresh();
  }

  return (
    <div className="flex min-h-[calc(100vh-6rem)] flex-col bg-[var(--surface)]">
      <header className="flex flex-wrap items-center gap-4 border-b border-[var(--border)] px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">{props.paper.title}</p>
          <p className="text-xs text-[var(--text-muted)]">
            {active
              ? 'Server-timed attempt in progress'
              : `Completed · ${props.attempt.status.replaceAll('_', ' ')}`}
          </p>
        </div>
        {active ? (
          <div
            aria-live="polite"
            className="rounded border border-[var(--border)] px-3 py-2 font-mono text-sm"
          >
            {formatSeconds(remaining)}
          </div>
        ) : (
          <div className="rounded bg-[var(--surface-raised)] px-3 py-2 text-sm font-medium">
            Score {props.attempt.score}/{props.attempt.maximumScore}
          </div>
        )}
        {active ? (
          <button
            className="rounded bg-[var(--accent)] px-4 py-2 text-sm font-medium text-[var(--accent-foreground)]"
            disabled={busy}
            onClick={finish}
            type="button"
          >
            Submit paper
          </button>
        ) : null}
      </header>

      <div className="grid min-h-0 flex-1 lg:grid-cols-[15rem_minmax(0,1fr)_minmax(24rem,1fr)]">
        <nav aria-label="Assessment questions" className="border-r border-[var(--border)] p-3">
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]">
            Questions
          </p>
          <div className="grid grid-cols-4 gap-2 lg:grid-cols-2">
            {props.questions.map((item) => {
              const itemAnswer = props.answers.find(
                (entry) => entry.paperQuestionId === item.id,
              );
              return (
                <button
                  aria-current={item.id === question.id}
                  className={`rounded border p-2 text-left text-xs ${item.id === question.id ? 'border-[var(--accent)] bg-[var(--surface-raised)]' : 'border-[var(--border)]'}`}
                  disabled={busy || !active}
                  key={item.id}
                  onClick={() => switchQuestion(item.id)}
                  type="button"
                >
                  <span className="font-medium">Q{item.ordinal}</span>
                  <span className="block text-[var(--text-muted)]">
                    {itemAnswer?.verdict
                      ? itemAnswer.verdict.replaceAll('_', ' ')
                      : 'not submitted'}
                  </span>
                </button>
              );
            })}
          </div>
        </nav>

        <main className="min-h-[30rem] overflow-auto border-r border-[var(--border)] p-5">
          <div className="flex items-center gap-3">
            <h1 className="min-w-0 flex-1 text-xl font-semibold">
              {question.ordinal}. {question.title}
            </h1>
            <DifficultyPill difficulty={question.difficulty} />
            <span className="text-xs text-[var(--text-muted)]">{question.marks} marks</span>
          </div>
          <p className="mt-5 whitespace-pre-wrap text-sm leading-relaxed">
            {question.statement}
          </p>
          {!active ? (
            <Link
              className="mt-6 inline-block text-sm text-[var(--accent)]"
              href={`/problems/${question.slug}/solve`}
            >
              Review editorial and solution →
            </Link>
          ) : null}
        </main>

        <section className="flex min-h-[38rem] flex-col">
          <div className="flex flex-wrap items-center gap-2 border-b border-[var(--border)] p-2">
            <select
              aria-label="Language"
              className="rounded border border-[var(--border)] bg-[var(--surface)] p-2 text-sm"
              disabled={!active}
              onChange={(event) => {
                const next = event.target.value;
                if (isExecutionLanguage(next)) {
                  setLanguage(next);
                  setSource(starters[next] ?? '');
                }
              }}
              value={language}
            >
              {EXECUTION_LANGUAGES.filter((item) => starters[item]).map((item) => (
                <option key={item} value={item}>
                  {EXECUTION_LANGUAGE_LABELS[item]}
                </option>
              ))}
            </select>
            <button
              className="ml-auto rounded border border-[var(--border)] px-3 py-2 text-sm"
              disabled={!active || busy}
              onClick={() => execute(false)}
              type="button"
            >
              Run code
            </button>
            <button
              className="rounded bg-[var(--accent)] px-3 py-2 text-sm font-medium text-[var(--accent-foreground)]"
              disabled={!active || busy}
              onClick={() => execute(true)}
              type="button"
            >
              Submit question
            </button>
          </div>
          <div className="min-h-[22rem] flex-1">
            <CodeEditor language={language} onChange={setSource} value={source} />
          </div>
          <div className="max-h-72 min-h-36 overflow-auto border-t border-[var(--border)] p-3">
            {message ? (
              <p className="text-sm text-[var(--danger)]" role="alert">
                {message}
              </p>
            ) : (
              <RunOutput result={result} />
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

function queuedResult(
  jobId: string,
  language: ExecutionLanguage,
  mode: 'run' | 'assessment',
): ExecutionResultView {
  return {
    jobId,
    language,
    mode,
    status: 'queued',
    scratchpad: false,
    verdict: null,
    runtimeMs: null,
    memoryKb: null,
    testsPassed: null,
    testsTotal: null,
    stdout: null,
    stderr: null,
    compileOutput: null,
    compilerRuntimeVersion: null,
    testResults: null,
    error: null,
  };
}

function secondsUntil(expiresAt: string): number {
  return Math.max(0, Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 1_000));
}

function formatSeconds(total: number): string {
  const minutes = Math.floor(total / 60)
    .toString()
    .padStart(2, '0');
  const seconds = (total % 60).toString().padStart(2, '0');
  return `${minutes}:${seconds}`;
}
