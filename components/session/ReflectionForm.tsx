'use client';

/**
 * The post-solve reflection — **skippable, and nudged rather than forced.**
 *
 * The nudge is that finishing a session brings the user here; the skip is a
 * button that costs one click. Anything stronger and the answers stop being
 * worth having: a required form is answered to get past it, and F2.1 and F3.5
 * would then be scheduling revisions from noise.
 *
 * Every option comes from `lib/reflection/taxonomy.ts`, the same array the
 * Postgres enums are built from, so a box the user can tick is a value the
 * database accepts.
 */
import { useState } from 'react';
import {
  MISTAKE_CATEGORIES,
  MISTAKE_CATEGORY_LABELS,
  type MistakeCategory,
  STUCK_CATEGORIES,
  STUCK_CATEGORY_LABELS,
  type StuckCategory,
} from '@/lib/reflection/taxonomy';

type Confidence = 'low' | 'medium' | 'high';

export type ReflectionInitial = {
  approach: string | null;
  achievedComplexity: string | null;
  stuckAreas: StuckCategory[];
  mistakes: MistakeCategory[];
  confidence: Confidence | null;
};

export function ReflectionForm({
  sessionId,
  initial,
  onSave,
  onSkip,
}: {
  sessionId: string;
  initial: ReflectionInitial;
  onSave: (input: {
    sessionId: string;
    approach?: string;
    achievedComplexity?: string;
    stuckAreas: StuckCategory[];
    mistakes: MistakeCategory[];
    confidence?: Confidence;
  }) => Promise<{ ok: boolean; message?: string }>;
  onSkip: () => void;
}) {
  const [approach, setApproach] = useState(initial.approach ?? '');
  const [complexity, setComplexity] = useState(initial.achievedComplexity ?? '');
  const [stuckAreas, setStuckAreas] = useState<StuckCategory[]>(initial.stuckAreas);
  const [mistakes, setMistakes] = useState<MistakeCategory[]>(initial.mistakes);
  const [confidence, setConfidence] = useState<Confidence | ''>(initial.confidence ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = <T,>(values: T[], value: T): T[] =>
    values.includes(value) ? values.filter((item) => item !== value) : [...values, value];

  return (
    <form
      className="flex max-w-2xl flex-col gap-6"
      onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true);
        setError(null);

        const result = await onSave({
          sessionId,
          ...(approach.trim() ? { approach: approach.trim() } : {}),
          ...(complexity.trim() ? { achievedComplexity: complexity.trim() } : {}),
          stuckAreas,
          mistakes,
          ...(confidence ? { confidence } : {}),
        });

        setBusy(false);
        if (!result.ok) setError(result.message ?? 'That did not save.');
      }}
    >
      <div>
        <label className="mb-1 block text-sm font-medium" htmlFor="approach">
          How did you approach it?
        </label>
        <textarea
          className="w-full rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
          id="approach"
          maxLength={4000}
          onChange={(event) => setApproach(event.target.value)}
          rows={4}
          value={approach}
        />
      </div>

      <fieldset>
        <legend className="mb-2 text-sm font-medium">Where were you stuck?</legend>
        <div className="flex flex-wrap gap-2">
          {STUCK_CATEGORIES.map((value) => (
            <Toggle
              checked={stuckAreas.includes(value)}
              key={value}
              label={STUCK_CATEGORY_LABELS[value]}
              onChange={() => setStuckAreas((current) => toggle(current, value))}
            />
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend className="mb-2 text-sm font-medium">What went wrong?</legend>
        <div className="flex flex-wrap gap-2">
          {MISTAKE_CATEGORIES.map((value) => (
            <Toggle
              checked={mistakes.includes(value)}
              key={value}
              label={MISTAKE_CATEGORY_LABELS[value]}
              onChange={() => setMistakes((current) => toggle(current, value))}
            />
          ))}
        </div>
        {/*
          Said out loud because the two are different data and the difference
          matters downstream: leaving this alone is a question unanswered,
          while "nothing went wrong" is an answer F3.5 can count.
        */}
        <p className="mt-2 text-xs text-[var(--text-muted)]">
          Leave this empty if you would rather not say — that is not the same as “nothing went
          wrong”.
        </p>
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-sm font-medium" htmlFor="complexity">
            Time complexity you achieved
          </label>
          <input
            className="w-full rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
            id="complexity"
            maxLength={120}
            onChange={(event) => setComplexity(event.target.value)}
            placeholder="O(n log n)"
            type="text"
            value={complexity}
          />
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium" htmlFor="confidence">
            How confident are you?
          </label>
          <select
            className="w-full rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
            id="confidence"
            onChange={(event) => setConfidence(event.target.value as Confidence | '')}
            value={confidence}
          >
            <option value="">Not saying</option>
            <option value="low">Low — I would struggle to redo this</option>
            <option value="medium">Medium — I could redo it with effort</option>
            <option value="high">High — I could redo it cleanly</option>
          </select>
        </div>
      </div>

      {error ? (
        <p className="text-sm text-[var(--danger)]" role="status">
          {error}
        </p>
      ) : null}

      <div className="flex items-center gap-3">
        <button
          aria-disabled={busy}
          className="rounded-[var(--radius)] bg-[var(--accent)] px-3 py-2 text-sm font-medium text-[var(--accent-foreground)] aria-disabled:opacity-60"
          type="submit"
        >
          {busy ? 'Saving…' : 'Save reflection'}
        </button>

        <button
          className="text-sm text-[var(--text-muted)] underline"
          onClick={onSkip}
          type="button"
        >
          Skip for now
        </button>
      </div>
    </form>
  );
}

/** A checkbox that reads as a chip. The input stays real, so the label works. */
function Toggle({
  checked,
  label,
  onChange,
}: {
  checked: boolean;
  label: string;
  onChange: () => void;
}) {
  return (
    <label
      className={`inline-flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1 text-sm ${
        checked
          ? 'border-[var(--accent)] text-[var(--text-primary)]'
          : 'border-[var(--border)] text-[var(--text-muted)]'
      }`}
    >
      <input checked={checked} className="size-3" onChange={onChange} type="checkbox" />
      {label}
    </label>
  );
}
