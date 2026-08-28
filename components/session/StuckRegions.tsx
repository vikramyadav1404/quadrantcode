'use client';

/**
 * Where you may have got stuck — and the chance to say we were wrong.
 *
 * ## Every sentence here hedges, and that is a constraint not a style
 *
 * **C4**: this project never claims to have detected anything. The heading says
 * "likely stuck around lines 16–20", never "you got stuck at line 18". A test
 * greps this file and the inference module for the words that would overstate,
 * with a control proving the grep can see them.
 *
 * The reason is not politeness. These signals see timing and edits; they do not
 * see the user. Somebody whose edits circled one function for six minutes may
 * have been stuck, or reading, or on the phone — and a product that tells them
 * which is a product they will stop believing the first time it is wrong.
 *
 * ## Which is why every row can be answered
 *
 * Confirm, adjust the range, or dismiss. A dismissed region counts for nothing
 * afterwards — not a little less, nothing. The user said it was wrong, and
 * continuing to weigh it is disagreeing with them quietly.
 */
import { useState } from 'react';
import {
  CONFIDENCE_LABELS,
  describeRegion,
  type StuckStatus,
} from '@/lib/inference/confidence';
import { formatSpan, type StuckRegionView } from '@/lib/inference/view';

type AnswerResult = { ok: boolean; message?: string };

export function StuckRegions({
  regions,
  onAnswer,
}: {
  regions: StuckRegionView[];
  onAnswer: (input: {
    stuckPointId: string;
    action: 'confirm' | 'dismiss' | 'adjust';
    lineStart?: number;
    lineEnd?: number;
  }) => Promise<AnswerResult>;
}) {
  if (regions.length === 0) {
    return (
      <p className="text-sm text-[var(--text-muted)]">
        Nothing here looked like a stuck point. That is not a verdict on the session — these
        signals only see timing and edits.
      </p>
    );
  }

  return (
    <ol aria-label="Possible stuck points" className="flex flex-col gap-3">
      {regions.map((region) => (
        <Region key={region.id} onAnswer={onAnswer} region={region} />
      ))}
    </ol>
  );
}

function Region({
  region,
  onAnswer,
}: {
  region: StuckRegionView;
  onAnswer: Parameters<typeof StuckRegions>[0]['onAnswer'];
}) {
  const [status, setStatus] = useState<StuckStatus>(region.status);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [from, setFrom] = useState(String(region.lineStart ?? ''));
  const [to, setTo] = useState(String(region.lineEnd ?? ''));

  const answer = async (
    action: 'confirm' | 'dismiss' | 'adjust',
    lines?: { lineStart: number; lineEnd: number },
  ) => {
    setBusy(true);
    const result = await onAnswer({ stuckPointId: region.id, action, ...lines });
    if (result.ok) {
      setStatus(action === 'dismiss' ? 'dismissed' : 'confirmed');
      setEditing(false);
    }
    setBusy(false);
  };

  const range =
    region.lineStart !== null && region.lineEnd !== null
      ? describeRegion(region.lineStart, region.lineEnd)
      : null;

  return (
    <li
      className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-4"
      data-status={status}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-medium">
          {CONFIDENCE_LABELS[region.confidence]}
          {range ? ` ${range}` : ''}
        </span>
        <span className="text-sm text-[var(--text-muted)]">
          {formatSpan(region.startedSeconds)} in
          {region.durationSeconds > 0 ? ` · lasted ${formatSpan(region.durationSeconds)}` : ''}
        </span>
      </div>

      {/*
        The evidence, always. A confidence label on its own is a number the user
        cannot argue with, and arguing with it is the whole point of this panel.
      */}
      <ul className="mt-1 text-sm text-[var(--text-muted)]">
        {region.evidence.map((sentence, index) => (
          <li key={`${region.id}-evidence-${index}`}>· {sentence}</li>
        ))}
      </ul>

      {region.note ? <p className="mt-1 text-sm">&ldquo;{region.note}&rdquo;</p> : null}

      {/*
        A marker the user typed is already their own statement. Offering to
        "confirm" it would be asking somebody to agree with themselves.
      */}
      {region.source === 'inferred' ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {status === 'inferred' ? (
            <>
              <button
                className="rounded-[var(--radius)] border border-[var(--border)] px-2 py-1 text-sm"
                disabled={busy}
                onClick={() => void answer('confirm')}
                type="button"
              >
                Yes, I was stuck here
              </button>
              <button
                className="rounded-[var(--radius)] border border-[var(--border)] px-2 py-1 text-sm"
                disabled={busy}
                onClick={() => setEditing((value) => !value)}
                type="button"
              >
                Adjust the lines
              </button>
              <button
                className="rounded-[var(--radius)] border border-[var(--border)] px-2 py-1 text-sm text-[var(--text-muted)]"
                disabled={busy}
                onClick={() => void answer('dismiss')}
                type="button"
              >
                No, I wasn&rsquo;t
              </button>
            </>
          ) : (
            <p className="text-sm text-[var(--text-muted)]" role="status">
              {status === 'confirmed'
                ? 'You confirmed this.'
                : 'You dismissed this. It counts for nothing.'}
            </p>
          )}
        </div>
      ) : null}

      {editing ? (
        <div className="mt-2 flex flex-wrap items-end gap-2">
          <label className="text-sm">
            From line
            <input
              className="ml-1 w-16 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] px-1 py-0.5"
              inputMode="numeric"
              onChange={(event) => setFrom(event.target.value)}
              value={from}
            />
          </label>
          <label className="text-sm">
            to
            <input
              className="ml-1 w-16 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] px-1 py-0.5"
              inputMode="numeric"
              onChange={(event) => setTo(event.target.value)}
              value={to}
            />
          </label>
          <button
            className="rounded-[var(--radius)] border border-[var(--border)] px-2 py-1 text-sm"
            disabled={busy}
            onClick={() =>
              void answer('adjust', {
                lineStart: Number(from),
                lineEnd: Number(to),
              })
            }
            type="button"
          >
            Save the range
          </button>
        </div>
      ) : null}
    </li>
  );
}
