'use client';

/**
 * Daily-goal settings, including the timezone.
 *
 * THE TIMEZONE COPY IS LOAD-BEARING, not decoration. Changing zone can make the
 * same local date appear twice, or make a day look skipped despite the user
 * solving every calendar day they lived through (D18). Both read as a broken
 * streak rather than a policy. The behaviour is correct; correct and
 * unexplained is indistinguishable from a defect, so it is explained — and
 * explained BEFORE saving, because afterwards the user is already looking at a
 * history that appears wrong.
 */
import { useState } from 'react';
import { type SaveGoalsResult, saveGoalsAction } from './actions';

const field =
  'w-full rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm';

export function GoalsForm({
  initial,
}: {
  initial: {
    targetProblems: number;
    minMedium: number;
    reminderTimeLocal: string;
    timezone: string;
  };
}) {
  const [values, setValues] = useState(initial);
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [error, setError] = useState<string | null>(null);

  const timezoneChanged = values.timezone !== initial.timezone;

  const set = <K extends keyof typeof values>(key: K, value: (typeof values)[K]) => {
    setValues((current) => ({ ...current, [key]: value }));
    setStatus('idle');
  };

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={async (event) => {
        event.preventDefault();
        setStatus('saving');
        setError(null);
        const result: SaveGoalsResult = await saveGoalsAction(values);
        if (result.ok) {
          setStatus('saved');
        } else {
          setError(result.message);
          setStatus('idle');
        }
      }}
    >
      <div>
        <label className="mb-1 block text-sm" htmlFor="targetProblems">
          Problems per day
        </label>
        <input
          className={field}
          id="targetProblems"
          max={20}
          min={1}
          onChange={(event) => set('targetProblems', Number(event.target.value))}
          type="number"
          value={values.targetProblems}
        />
      </div>

      <div>
        <label className="mb-1 block text-sm" htmlFor="minMedium">
          Minimum mediums per day
        </label>
        <input
          className={field}
          id="minMedium"
          max={20}
          min={0}
          onChange={(event) => set('minMedium', Number(event.target.value))}
          type="number"
          value={values.minMedium}
        />
        {/*
          Captured and not used by the completion rule. Said plainly rather than
          letting the user infer it affects their streak — the same instinct as
          the reminder note below.
        */}
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          Recorded for later. It does not currently affect whether a day counts.
        </p>
      </div>

      <div>
        <label className="mb-1 block text-sm" htmlFor="reminderTimeLocal">
          Preferred reminder time
        </label>
        <input
          className={field}
          id="reminderTimeLocal"
          onChange={(event) => set('reminderTimeLocal', event.target.value)}
          type="time"
          value={values.reminderTimeLocal}
        />
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          Saved with your settings. Reminders are not sent yet.
        </p>
      </div>

      <div>
        <label className="mb-1 block text-sm" htmlFor="timezone">
          Timezone
        </label>
        <input
          aria-describedby={timezoneChanged ? 'timezone-effect' : undefined}
          className={field}
          id="timezone"
          onChange={(event) => set('timezone', event.target.value)}
          placeholder="Asia/Kolkata"
          type="text"
          value={values.timezone}
        />

        {timezoneChanged ? (
          <p
            className="mt-2 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface-raised)] p-3 text-sm"
            id="timezone-effect"
            role="status"
          >
            <strong>Your past days stay as recorded.</strong> Only days from now on use the new
            timezone. Because of the shift, a date near the change may appear twice or look
            skipped in your history — your streak is not affected.
          </p>
        ) : null}
      </div>

      {error ? (
        <p className="text-sm text-[var(--danger)]" role="status">
          {error}
        </p>
      ) : null}

      <button
        aria-disabled={status === 'saving'}
        className="self-start rounded-[var(--radius)] bg-[var(--accent)] px-3 py-2 text-sm font-medium text-[var(--accent-foreground)] aria-disabled:opacity-60"
        type="submit"
      >
        {status === 'saving' ? 'Saving…' : status === 'saved' ? 'Saved' : 'Save goals'}
      </button>
    </form>
  );
}
