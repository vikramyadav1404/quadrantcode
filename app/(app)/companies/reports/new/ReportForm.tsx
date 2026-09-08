'use client';

import { useActionState } from 'react';
import { submitInterviewReportAction, type ReportActionState } from './actions';

export function ReportForm({ companies }: { companies: Array<{ id: string; name: string }> }) {
  const [state, action, pending] = useActionState<ReportActionState, FormData>(
    submitInterviewReportAction,
    { error: null },
  );
  return (
    <form
      action={action}
      className="grid gap-5 rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] p-5 md:grid-cols-2"
    >
      <Select
        label="Company"
        name="companyId"
        required
        options={companies.map((company) => ({ value: company.id, label: company.name }))}
      />
      <Field label="Role" name="role" placeholder="Software Development Engineer" required />
      <Select
        label="Candidate category"
        name="candidateLevel"
        required
        options={[
          { value: 'internship', label: 'Internship' },
          { value: 'fresher', label: 'Fresher' },
          { value: 'experienced', label: 'Experienced' },
        ]}
      />
      <Field label="Interview year" name="interviewYear" required type="number" />
      <Field label="Location (optional)" name="location" />
      <Field label="Round" name="round" placeholder="Technical round 1" required />
      <Field
        label="Question concept"
        name="concept"
        placeholder="Sliding window with frequency counts"
        required
        wide
      />
      <Select
        label="Estimated difficulty"
        name="difficulty"
        required
        options={[
          { value: 'easy', label: 'Easy' },
          { value: 'medium', label: 'Medium' },
          { value: 'hard', label: 'Hard' },
        ]}
      />
      <Field
        label="Topics (comma separated)"
        name="topics"
        placeholder="arrays-hashing, sliding-window"
        required
      />
      <TextArea
        label="Your independently written recollection"
        name="recollection"
        required
        wide
        rows={7}
      />
      <TextArea label="Interview experience" name="experience" required wide rows={8} />
      <Field label="Optional public source URL" name="publicSourceUrl" type="url" wide />

      <div className="md:col-span-2 rounded-[var(--radius)] border border-[var(--warning)]/40 bg-[var(--surface-raised)] p-4 text-sm">
        <p className="font-medium">
          Do not submit active-assessment answers, stolen tests, confidential material,
          NDA-protected content, or exact live hiring-test leaks.
        </p>
        <div className="mt-3 space-y-3 text-[var(--text-muted)]">
          <Check name="originalAndNdaSafe">
            This recollection is my own writing and does not violate an NDA.
          </Check>
          <Check name="displayPermission">
            Quadrantcode may review, edit without changing meaning, and display it after
            moderation.
          </Check>
          <Check name="displayAnonymously" required={false}>
            Display my report anonymously if it is published.
          </Check>
        </div>
      </div>
      {state.error ? (
        <p className="md:col-span-2 text-sm text-[var(--danger)]" role="alert">
          {state.error}
        </p>
      ) : null}
      <button
        className="md:col-span-2 justify-self-start rounded bg-[var(--accent)] px-5 py-2.5 font-medium text-[var(--accent-foreground)] disabled:opacity-60"
        disabled={pending}
        type="submit"
      >
        {pending ? 'Sending for review…' : 'Submit for moderator review'}
      </button>
    </form>
  );
}

function Field({
  label,
  name,
  wide,
  ...props
}: {
  label: string;
  name: string;
  wide?: boolean;
} & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className={`${wide ? 'md:col-span-2' : ''} text-sm`}>
      {label}
      <input
        className="mt-1 w-full rounded border border-[var(--border)] bg-[var(--surface)] p-2"
        name={name}
        {...props}
      />
    </label>
  );
}

function TextArea({
  label,
  name,
  wide,
  ...props
}: {
  label: string;
  name: string;
  wide?: boolean;
} & React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <label className={`${wide ? 'md:col-span-2' : ''} text-sm`}>
      {label}
      <textarea
        className="mt-1 w-full rounded border border-[var(--border)] bg-[var(--surface)] p-2"
        name={name}
        {...props}
      />
    </label>
  );
}

function Select({
  label,
  name,
  options,
  ...props
}: {
  label: string;
  name: string;
  options: Array<{ value: string; label: string }>;
} & React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <label className="text-sm">
      {label}
      <select
        className="mt-1 w-full rounded border border-[var(--border)] bg-[var(--surface)] p-2"
        name={name}
        {...props}
      >
        <option value="">Select…</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function Check({
  children,
  name,
  required = true,
}: {
  children: React.ReactNode;
  name: string;
  required?: boolean;
}) {
  return (
    <label className="flex items-start gap-2">
      <input className="mt-1" name={name} required={required} type="checkbox" />
      <span>{children}</span>
    </label>
  );
}
