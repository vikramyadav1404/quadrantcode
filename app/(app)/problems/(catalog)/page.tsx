/**
 * Problem catalog.
 *
 * A Server Component: filters are read from the URL, applied in SQL, and the
 * page is rendered on the server. Nothing about the filtering is client-side,
 * so a user cannot widen their own visibility by editing state.
 *
 * Two views. With no filter in the URL the catalog is grouped by topic
 * (`TopicSections`); any filter, a topic's "See all", or `?view=all` shows the
 * table. Both list easiest first, then by the problem's fixed number.
 */
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { PageHeader } from '@/components/ui/PageHeader';
import { LinkPending } from '@/components/ui/LinkPending';
import { EmptyState } from '@/components/ui/EmptyState';
import { DifficultyPill } from '@/components/solve/DifficultyPill';
import { StatusMark } from '@/components/solve/StatusMark';
import { TopicChips } from '@/components/solve/TopicChips';
import { getDb } from '@/server/db';
import { TopicSections } from '@/components/problems/TopicSections';
import {
  InvalidCursorError,
  type ProblemPage,
  type TopicSection,
  listCatalogPlatforms,
  listCatalogTopics,
  listProblemsOriginalsFirst,
  listTopicSections,
  parseFilters,
} from '@/server/services/problems';
import { platformLabel } from '@/lib/problems/platforms';
import { topicLabel } from '@/lib/problems/topics';
import { getCurrentUser } from '@/server/services/auth/session';
import { timed } from '@/server/lib/observability/logger';

export default async function ProblemsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;

  /*
   * The table when the reader asked for a list — any filter with a value, a
   * page token, or `view=all` — and the topic view otherwise. The filter form
   * carries `view=all`, so Apply always lands on the table, including an Apply
   * with every box left on "Any".
   */
  const FILTER_KEYS = [
    'search',
    'difficulty',
    'topic',
    'pattern',
    'platform',
    'source',
    'cursor',
  ];
  const tableView =
    params.view === 'all' ||
    FILTER_KEYS.some((key) => typeof params[key] === 'string' && params[key].trim() !== '');

  /*
   * TEMPORARY INSTRUMENTATION — remove once the numbers are read.
   *
   * `vercel logs` carries no duration field, so the split between database time
   * and everything else is not observable from outside. These two spans make it
   * observable: `problems.page` is this component's whole server-side cost and
   * `problems.list` is the three catalog queries inside it. The difference is
   * session lookup plus compute; the gap between `problems.page` and the request
   * time in the logs list is cold start plus the edge-to-region hop.
   *
   * `timed` is the sanctioned writer (`server/lib/observability/logger.ts`); it
   * redacts unconditionally and logs on failure too, which matters because a
   * span that only reports success hides exactly the slow paths worth finding.
   */
  const query = new URLSearchParams(
    Object.entries(params).flatMap(([key, value]) =>
      typeof value === 'string' && key !== 'cursor' ? [[key, value] as [string, string]] : [],
    ),
  );

  const { page, sections, platforms, topics } = await timed('problems.page', async () => {
    const signedIn = await getCurrentUser();
    const db = getDb();

    if (!tableView) {
      const [sections, platforms, topics] = await Promise.all([
        timed('problems.topics', () =>
          listTopicSections(db, { userId: signedIn?.id ?? null, perTopic: 5 }),
        ),
        listCatalogPlatforms(db),
        listCatalogTopics(db),
      ]);
      return { page: null, sections, platforms, topics };
    }

    const filters = parseFilters({
      difficulty: params.difficulty,
      topic: params.topic,
      pattern: params.pattern,
      platform: params.platform,
      source: params.source,
      search: params.search,
      cursor: params.cursor,
      limit: 25,
    });

    /*
     * Independent reads, so they run together rather than one after the other.
     *
     * Originals first unless a source is chosen: in a newest-first list, our
     * own problems sat wherever their import date put them among hundreds of
     * links out.
     */
    /*
     * A page token from before problem numbers existed carried the old
     * `created_at|id` key and no longer decodes. A kept "Next page" link
     * should land somewhere useful, so it restarts at the first page of the
     * same filters rather than showing an error.
     */
    let page: ProblemPage | 'stale-cursor';
    try {
      page = await timed('problems.list', () =>
        listProblemsOriginalsFirst({ db, filters, userId: signedIn?.id ?? null }),
      );
    } catch (error) {
      if (!(error instanceof InvalidCursorError)) throw error;
      page = 'stale-cursor';
    }
    const [platforms, topics] = await Promise.all([
      listCatalogPlatforms(db),
      listCatalogTopics(db),
    ]);

    return { page, sections: [] as TopicSection[], platforms, topics };
  });

  if (page === 'stale-cursor') redirect(query.size > 0 ? `/problems?${query}` : '/problems');
  const rows = page?.rows ?? [];
  const nextCursor = page?.nextCursor ?? null;
  const selectedTopic = typeof params.topic === 'string' ? params.topic.trim() : '';

  return (
    <>
      <PageHeader
        title="Problems"
        /*
          Describes the feature, not just the content policy.

          This read "Metadata and links only — solving happens on the original
          platform", which defends C1 correctly and was then read as "this app
          has no solve experience". It does: an editor, a server-authoritative
          timer, stuck markers and reflection are one click away. The old copy
          undersold the whole differentiator on the first page anyone lands on.
        */
        /*
          "never the problem text" stopped being true when original problems
          went live: those carry a statement that is ours. C1 still holds for
          external links, and the wording now says which is which rather than
          making one claim about both.
        */
        description="Solve on the original platform or in the built-in editor — Quadrantcode records how the solve went. External problems link out; original problems are ours."
      />

      {/*
        Two links rather than a control: each view has its own URL, so either
        can be bookmarked or shared, and Back moves between them.
      */}
      <nav aria-label="Catalog view" className="mb-4 flex gap-1 text-sm">
        {[
          { href: '/problems', label: 'By topic', current: !tableView },
          { href: '/problems?view=all', label: 'All problems', current: tableView },
        ].map((tab) => (
          <Link
            aria-current={tab.current ? 'page' : undefined}
            className={`rounded-[var(--radius)] px-3 py-1.5 ${
              tab.current
                ? 'bg-[var(--surface-raised)] font-medium text-[var(--accent)]'
                : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
            }`}
            href={tab.href}
            key={tab.href}
          >
            {tab.label}
          </Link>
        ))}
      </nav>

      {/*
        Keyed on the query so it remounts on every change of filters. The view
        links and "See all" are client navigations that reuse this element, and
        an uncontrolled select keeps the value it already has: "See all" would
        land on a topic's list with the topic filter still reading "Any topic".
      */}
      <form className="mb-6 flex flex-wrap gap-2" key={query.toString()} method="get">
        <input name="view" type="hidden" value="all" />
        <input
          aria-label="Search problems by title"
          className="min-w-48 flex-1 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
          defaultValue={typeof params.search === 'string' ? params.search : ''}
          name="search"
          placeholder="Search titles…"
          type="search"
        />
        <select
          aria-label="Filter by difficulty"
          className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
          defaultValue={typeof params.difficulty === 'string' ? params.difficulty : ''}
          name="difficulty"
        >
          <option value="">Any difficulty</option>
          <option value="easy">Easy</option>
          <option value="medium">Medium</option>
          <option value="hard">Hard</option>
        </select>
        {/*
          Topics come from the data, in the topic view's order, so every
          choice has at least one problem behind it.
        */}
        <select
          aria-label="Filter by topic"
          className="max-w-56 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
          defaultValue={selectedTopic}
          name="topic"
        >
          <option value="">Any topic</option>
          {topics.map((entry) => (
            <option key={entry.topic} value={entry.topic}>
              {topicLabel(entry.topic)} ({entry.total})
            </option>
          ))}
        </select>
        <select
          aria-label="Filter by source"
          className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
          defaultValue={
            params.source === 'original' || params.source === 'external' ? params.source : ''
          }
          name="source"
        >
          <option value="">Any source</option>
          <option value="original">Original</option>
          <option value="external">External link</option>
        </select>
        {/*
          Options come from the data (listCatalogPlatforms), so every choice
          has at least one problem behind it. A platform in the URL that is no
          longer offered still filters; it simply is not preselected.
        */}
        <select
          aria-label="Filter by platform"
          className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
          defaultValue={
            typeof params.platform === 'string' && platforms.includes(params.platform)
              ? params.platform
              : ''
          }
          name="platform"
        >
          <option value="">Any platform</option>
          {platforms.map((platform) => (
            <option key={platform} value={platform}>
              {platformLabel(platform)}
            </option>
          ))}
        </select>
        <button
          className="rounded-[var(--radius)] bg-[var(--accent)] px-3 py-2 text-sm font-medium text-[var(--accent-foreground)]"
          type="submit"
        >
          Apply
        </button>
      </form>

      {!tableView ? (
        sections.length === 0 ? (
          <EmptyState
            title="No topics yet"
            description="Problems appear here grouped by topic once they are tagged and published."
          />
        ) : (
          <TopicSections sections={sections} />
        )
      ) : null}

      {tableView && selectedTopic ? (
        <p className="mb-3 text-sm">
          <span className="font-medium">{topicLabel(selectedTopic)}</span>
          <span className="text-[var(--text-muted)]"> · easiest first · </span>
          <Link className="underline" href="/problems">
            All topics
          </Link>
        </p>
      ) : null}

      {!tableView ? null : rows.length === 0 ? (
        <EmptyState
          title="No problems match those filters"
          description="Try clearing the search or widening the difficulty, source or platform."
        />
      ) : (
        <div className="overflow-x-auto rounded-[var(--radius)] border border-[var(--border)]">
          <table className="w-full border-collapse text-sm">
            <caption className="sr-only">Problem catalog</caption>
            <thead>
              <tr className="border-b border-[var(--border)] bg-[var(--surface)] text-left">
                <th className="w-10 px-3 py-2.5 font-medium" scope="col">
                  <span className="sr-only">Status</span>
                </th>
                <th className="w-16 px-3 py-2.5 font-medium" scope="col">
                  #
                </th>
                <th className="px-3 py-2.5 font-medium" scope="col">
                  Title
                </th>
                <th className="px-3 py-2.5 font-medium" scope="col">
                  Difficulty
                </th>
                <th className="px-3 py-2.5 font-medium" scope="col">
                  Topics
                </th>
                <th className="px-3 py-2.5 font-medium" scope="col">
                  Source
                </th>
                <th className="px-3 py-2.5 text-right font-medium" scope="col">
                  Est.
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((problem) => (
                <tr
                  className="border-b border-[var(--border)] transition-colors last:border-0 hover:bg-[var(--surface)]"
                  key={problem.id}
                >
                  <td className="px-3 py-2.5">
                    <StatusMark status={problem.userStatus} />
                  </td>
                  <td className="px-3 py-2.5 tabular-nums text-[var(--text-muted)]">
                    {problem.number}
                  </td>
                  <td className="px-3 py-2.5">
                    <Link
                      className="rounded-sm font-medium text-[var(--text-primary)] transition-colors hover:text-[var(--accent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
                      href={`/problems/${problem.slug}`}
                    >
                      {problem.title}
                      <LinkPending />
                    </Link>
                  </td>
                  <td className="px-3 py-2.5">
                    <DifficultyPill difficulty={problem.difficulty} />
                  </td>
                  <td className="px-3 py-2.5">
                    <span className="flex flex-wrap gap-1">
                      <TopicChips
                        topics={problem.tags
                          .filter((tag) => tag.tagType === 'topic')
                          .map((tag) => tag.tagValue)}
                      />
                    </span>
                  </td>
                  {/*
                    Already on the row and never rendered until now. For a
                    catalog that is 100% external links, "which site am I about
                    to be sent to" is the one thing a reader cannot infer from
                    the title.
                  */}
                  <td className="whitespace-nowrap px-3 py-2.5 text-[var(--text-muted)]">
                    {problem.sourceType === 'original'
                      ? 'Original'
                      : problem.platform
                        ? platformLabel(problem.platform)
                        : '—'}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-[var(--text-muted)]">
                    {problem.estimatedMinutes}m
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tableView && nextCursor ? (
        <Link
          className="mt-4 inline-block rounded-[var(--radius)] border border-[var(--border)] px-3 py-2 text-sm"
          href={`/problems?${query.toString()}${query.size > 0 ? '&' : ''}cursor=${encodeURIComponent(nextCursor)}`}
        >
          Next page
          <LinkPending />
        </Link>
      ) : null}
    </>
  );
}
