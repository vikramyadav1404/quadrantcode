'use client';

/**
 * How a solve unfolded, top to bottom.
 *
 * ## Everything a program or a user wrote is a text node
 *
 * This page renders two kinds of untrusted bytes — program output and the
 * user's own source — and both go through `{value}`. There is no
 * `dangerouslySetInnerHTML` in this directory, the same rule
 * `components/editor/RunOutput.tsx` carries, and the grep test that guards the
 * editor route covers this one too.
 *
 * A client component only because the code panels expand. Everything rendered
 * arrives as props; nothing is computed here.
 */
import { useState } from 'react';
import {
  EVENT_ICONS,
  formatElapsed,
  type TimelineRowView,
  type TimelineView,
} from '@/lib/timeline/view';
import { SESSION_EVENT_LABELS } from '@/lib/timeline/events';
import { VERDICT_LABELS } from '@/lib/execution/languages';
import { formatMemory, formatRuntime } from '@/lib/execution/view';

export function Timeline({ view }: { view: TimelineView }) {
  if (view.rows.length === 0) {
    return (
      <p className="text-sm text-[var(--text-muted)]">Nothing was recorded for this session.</p>
    );
  }

  return (
    <ol aria-label="Session timeline" className="flex flex-col">
      {view.rows.map((row) => (
        <Row key={row.id} row={row} />
      ))}
    </ol>
  );
}

function Row({ row }: { row: TimelineRowView }) {
  const [open, setOpen] = useState(false);

  return (
    <li className="flex gap-3 border-l border-[var(--border)] pb-4 pl-4">
      <span
        aria-hidden="true"
        className="-ml-[1.4rem] flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--surface-raised)] text-xs"
      >
        {EVENT_ICONS[row.type]}
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-3">
          <span className="font-mono text-xs text-[var(--text-muted)] tabular-nums">
            {formatElapsed(row.elapsedMs)}
          </span>
          <span className="text-sm font-medium">{SESSION_EVENT_LABELS[row.type]}</span>
        </div>

        {row.detail ? (
          <p className="mt-0.5 text-sm text-[var(--text-muted)]">{row.detail}</p>
        ) : null}

        {row.run ? (
          <div className="mt-1">
            <p className="text-sm">
              <span className="font-medium">{VERDICT_LABELS[row.run.verdict]}</span>
              <span className="text-[var(--text-muted)]">
                {' · '}
                {formatRuntime(row.run.runtimeMs)} · {formatMemory(row.run.memoryKb)}
              </span>
            </p>
            {/* Program output. A text node, never markup — see the file header. */}
            <Output label="Output" value={row.run.stdout} />
            <Output label="Errors" value={row.run.stderr} />
          </div>
        ) : null}

        {row.snapshot ? (
          <div className="mt-1">
            <p className="text-sm text-[var(--text-muted)]">{changeCount(row.snapshot)}</p>

            {/*
              The summariser's sentences. They describe what changed and never
              why it was wrong — intent is something nothing here observed.
            */}
            {row.snapshot.changes.length > 0 ? (
              <ul className="mt-0.5 text-sm text-[var(--text-muted)]">
                {row.snapshot.changes.map((sentence, index) => (
                  <li key={`${row.id}-change-${index}`}>· {sentence}</li>
                ))}
              </ul>
            ) : null}

            <button
              aria-expanded={open}
              className="mt-1 text-sm underline"
              onClick={() => setOpen((value) => !value)}
              type="button"
            >
              {open ? 'Hide code' : 'Show code'}
            </button>

            {open ? (
              <pre
                className="mt-1 max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface-raised)] p-3 font-mono text-xs"
                data-testid="timeline-source"
              >
                {row.snapshot.source}
              </pre>
            ) : null}
          </div>
        ) : null}
      </div>
    </li>
  );
}

/** `+3 −1 ~2`, or "First version" when there is nothing to compare against. */
function changeCount(snapshot: NonNullable<TimelineRowView['snapshot']>): string {
  const { linesAdded, linesRemoved, linesModified } = snapshot;

  if (linesAdded + linesRemoved + linesModified === 0) return 'First version';

  const parts: string[] = [];
  if (linesAdded > 0) parts.push(`${linesAdded} added`);
  if (linesRemoved > 0) parts.push(`${linesRemoved} removed`);
  if (linesModified > 0) parts.push(`${linesModified} changed`);

  return parts.join(', ');
}

/** One stream of program output. `{value}` and nothing else. */
function Output({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;

  return (
    <pre
      className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface-raised)] p-2 font-mono text-xs"
      data-testid={`timeline-run-${label.toLowerCase()}`}
    >
      {value}
    </pre>
  );
}
