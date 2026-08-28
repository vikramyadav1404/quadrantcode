/**
 * One row per topic: how much, how long, how often it went wrong, how sure.
 *
 * A plain table rather than `DataTable`, which is generic over cursor-paginated
 * server pages. This set is one row per topic a user has touched — a dozen at
 * most — so pagination would be machinery around nothing.
 */
import {
  type TopicRow,
  formatConfidence,
  formatDuration,
  formatRatio,
} from '@/lib/analytics/view';

export function TopicTable({ topics }: { topics: TopicRow[] }) {
  if (topics.length === 0) {
    return (
      <p className="text-sm text-[var(--text-muted)]">
        No topics yet. Finish a session on a tagged problem and it appears here.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="text-[var(--text-muted)]">
          <tr>
            <th className="py-2 pr-4 font-medium">Topic</th>
            <th className="py-2 pr-4 font-medium">Solved</th>
            <th className="py-2 pr-4 font-medium">Avg time</th>
            <th className="py-2 pr-4 font-medium">Ended stuck</th>
            <th className="py-2 pr-4 font-medium">Confidence</th>
            <th className="py-2 font-medium">Last practised</th>
          </tr>
        </thead>
        <tbody>
          {topics.map((topic) => (
            <tr className="border-t border-[var(--border)]" key={topic.topic}>
              <td className="py-2 pr-4">{topic.topic}</td>
              <td className="py-2 pr-4 tabular-nums">{topic.solvedCount}</td>
              <td className="py-2 pr-4 tabular-nums">
                {formatDuration(topic.averageActiveSeconds)}
              </td>
              {/*
                "3 of 12" rather than "0.25". A ratio out of the sessions it came
                from is checkable; a decimal is a claim the reader has to trust.
              */}
              <td className="py-2 pr-4 tabular-nums">
                {formatRatio(topic.failedAttemptRatio, topic.sessionCount)}
              </td>
              <td className="py-2 pr-4">{formatConfidence(topic.averageConfidence)}</td>
              <td className="py-2 tabular-nums">{topic.lastPractisedDate ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
