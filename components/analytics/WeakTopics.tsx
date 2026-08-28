/**
 * The topics worth attention next, and why.
 *
 * **The reasons are not decoration.** The score is a deterministic sum of four
 * things the user already did (`docs/scoring.md`), and the panel shows the
 * sentences that produced it so the reader can disagree. A bare "graphs, 71"
 * is a number nobody can check, and a number nobody can check gets ignored.
 *
 * Nothing here recalculates anything: the score and its reasons arrive as
 * props, because a component doing its own arithmetic would be a second copy of
 * the formula, and the two would eventually disagree on the same screen.
 */
import type { WeakTopic } from '@/lib/analytics/view';

export function WeakTopics({ topics }: { topics: WeakTopic[] }) {
  if (topics.length === 0) {
    return (
      <p className="text-sm text-[var(--text-muted)]">
        Not enough history yet. A topic needs a few finished sessions before there is anything
        worth saying about it.
      </p>
    );
  }

  return (
    <ol className="flex flex-col gap-3">
      {topics.map((topic) => (
        <li
          className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-3"
          key={topic.topic}
        >
          <div className="flex items-baseline justify-between gap-3">
            <span className="font-medium">{topic.topic}</span>
            <span
              className="text-sm tabular-nums text-[var(--text-muted)]"
              title="A 0-100 score computed from four things you have already done"
            >
              {topic.score}
            </span>
          </div>

          {/* Always present — the score is never shown without its account. */}
          <p className="mt-1 text-sm text-[var(--text-muted)]">{topic.reasons.join(' · ')}</p>
        </li>
      ))}
    </ol>
  );
}
