/**
 * The catalog grouped by topic — the default view of /problems.
 *
 * Each topic gets its counts by difficulty and its first few problems, easiest
 * first and then by number, with a link to the full list. Showing every
 * problem under every topic would be tens of thousands of rows on one page;
 * the full list is one click away and paginates.
 *
 * Rows are a list, not a table: a section is read top to bottom and the row's
 * title is its one action, so there is nothing a column header would add.
 */
import Link from 'next/link';
import { DifficultyPill } from '@/components/solve/DifficultyPill';
import { StatusMark } from '@/components/solve/StatusMark';
import { LinkPending } from '@/components/ui/LinkPending';
import { platformLabel } from '@/lib/problems/platforms';
import { type TopicSection, topicLabel } from '@/lib/problems/topics';

const count = new Intl.NumberFormat('en-US');

const CHIP =
  'rounded-full border border-[var(--border)] bg-[var(--surface-raised)] px-2.5 py-1 text-xs text-[var(--text-muted)] transition-colors hover:text-[var(--text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]';

export function TopicSections({ sections }: { sections: TopicSection[] }) {
  return (
    <>
      <nav aria-label="Jump to a topic" className="mb-6 flex flex-wrap gap-1.5">
        {sections.map((section) => (
          <a className={CHIP} href={`#topic-${section.topic}`} key={section.topic}>
            {topicLabel(section.topic)}{' '}
            <span className="tabular-nums">{count.format(section.total)}</span>
          </a>
        ))}
      </nav>

      <div className="flex flex-col gap-4">
        {sections.map((section) => {
          const label = topicLabel(section.topic);
          const headingId = `topic-${section.topic}-heading`;
          return (
            <section
              aria-labelledby={headingId}
              className="scroll-mt-4 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-4"
              id={`topic-${section.topic}`}
              key={section.topic}
            >
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <h2 className="text-base font-semibold tracking-tight" id={headingId}>
                  {label}
                </h2>
                <p className="text-xs tabular-nums text-[var(--text-muted)]">
                  {count.format(section.total)} {section.total === 1 ? 'problem' : 'problems'} ·{' '}
                  <span style={{ color: 'var(--success)' }}>
                    Easy {count.format(section.easy)}
                  </span>
                  {' · '}
                  <span style={{ color: 'var(--warning)' }}>
                    Medium {count.format(section.medium)}
                  </span>
                  {' · '}
                  <span style={{ color: 'var(--danger)' }}>
                    Hard {count.format(section.hard)}
                  </span>
                </p>
              </div>

              <ol className="mt-3 divide-y divide-[var(--border)]">
                {section.problems.map((problem, index) => (
                  <li className="flex items-center gap-3 py-2 text-sm" key={problem.id}>
                    <StatusMark status={problem.userStatus} />
                    {/* Position within this topic, 1 to n: see the catalog page header. */}
                    <span
                      aria-hidden="true"
                      className="w-8 shrink-0 tabular-nums text-[var(--text-muted)]"
                    >
                      {index + 1}.
                    </span>
                    <Link
                      className="min-w-0 flex-1 truncate rounded-sm font-medium text-[var(--text-primary)] transition-colors hover:text-[var(--accent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
                      href={`/problems/${problem.slug}`}
                    >
                      {problem.title}
                      <LinkPending />
                    </Link>
                    <DifficultyPill difficulty={problem.difficulty} />
                    <span className="hidden w-24 shrink-0 text-right text-[var(--text-muted)] sm:inline">
                      {problem.sourceType === 'original'
                        ? 'Original'
                        : problem.platform
                          ? platformLabel(problem.platform)
                          : '—'}
                    </span>
                  </li>
                ))}
              </ol>

              {section.total > section.problems.length ? (
                <Link
                  className="mt-2 inline-block text-sm underline"
                  href={`/problems?topic=${encodeURIComponent(section.topic)}`}
                >
                  See all {count.format(section.total)} in {label}
                  <LinkPending />
                </Link>
              ) : null}
            </section>
          );
        })}
      </div>
    </>
  );
}
