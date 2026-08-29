/**
 * Topics as chips rather than a comma-separated string.
 *
 * ## `interactive` exists because links cost tab stops
 *
 * The first version made every chip a link everywhere. In the catalog TABLE
 * that doubles the keyboard cost of each row — the row's own title link, then a
 * chip, then the next row — and `e2e/keyboard.spec.ts` caught it: the fixture
 * rows fell outside the traversal budget.
 *
 * The fix is not a bigger budget. In a table the topic is INFORMATION and the
 * row's title is the action; on a problem's own page there is one set of chips
 * and "show me more of this topic" is a genuine next step. So the table gets
 * plain chips and the detail panel gets links.
 */
import Link from 'next/link';

const CHIP =
  'rounded-full border border-[var(--border)] bg-[var(--surface-raised)] px-2 py-0.5 text-xs text-[var(--text-muted)]';

export function TopicChips({
  topics,
  interactive = false,
}: {
  topics: string[];
  /** Links into the filtered catalog. Off in tables — see the header. */
  interactive?: boolean;
}) {
  if (topics.length === 0) return null;

  return (
    <>
      {topics.map((topic) =>
        interactive ? (
          <Link
            className={`${CHIP} transition-colors hover:text-[var(--text-primary)]`}
            href={`/problems?topic=${encodeURIComponent(topic)}`}
            key={topic}
          >
            {topic}
          </Link>
        ) : (
          <span className={CHIP} key={topic}>
            {topic}
          </span>
        ),
      )}
    </>
  );
}
