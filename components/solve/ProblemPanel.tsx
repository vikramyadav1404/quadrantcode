'use client';

/**
 * The left pane: what the problem is, and how you have done on it.
 *
 * ## What the Description tab shows when there is no statement
 *
 * Every problem in the catalog today is `external_link`, and **C1 means we hold
 * metadata and a link, never a statement** — enforced by the database, not just
 * by intent. There is no statement to render for any of them, and there never
 * will be.
 *
 * So the pane shows what actually exists and what the product is actually for:
 * difficulty, topics, the estimate, a prominent way out to the platform that
 * does hold the text, and **the reader's own record on this problem**. The last
 * one is the point — "we record how you solved it, not what it says" is the
 * thesis, and a pane with three sentences on it was not saying that.
 *
 * None of that needed a new query. `getProblemBySlug` already returned the
 * history, the estimate and the premium flag; the page simply was not passing
 * them.
 *
 * The statement branch below is not dead code waiting hopefully: `problems`
 * already carries `statement` for `source_type = 'original'`, and F4.1 is the
 * ticket that fills it. When it does, this pane fills with it and nothing here
 * changes.
 *
 * ## Markdown is not rendered as HTML
 *
 * When a statement does arrive it is our own text (C2) — but it is still text
 * from a database, and `RunOutput.tsx` set the rule this project follows: it
 * goes through a text node. Paragraph splitting only, no HTML parsing, no
 * `dangerouslySetInnerHTML`.
 */
import { Fragment, useState } from 'react';
import Link from 'next/link';
import { DifficultyPill } from './DifficultyPill';
import { StatusMark } from './StatusMark';
import { TopicChips } from './TopicChips';
import { EVIDENCE_TYPE_LABELS, type EvidenceType } from '@/lib/native/constants';

type NativeProblemPanelView = {
  story: string;
  inputFormat: string;
  outputFormat: string;
  constraints: string[];
  hints: string[];
  functionContract: {
    className?: string;
    functionName: string;
    parameters: Array<{ name: string; type: string; description: string }>;
    returnType: string;
  };
  examples: Array<{ input: string; output: string; explanation: string }>;
  companies: Array<{ name: string; slug: string; evidenceType: EvidenceType }>;
  editorial: {
    overview: string;
    bruteForceApproach: string | null;
    optimalApproach: string;
    correctnessProof: string;
    timeComplexity: string;
    spaceComplexity: string;
  } | null;
};

/**
 * The reader's own standing on this problem.
 *
 * Dates arrive PREFORMATTED. This is a client component, so a `Date` formatted
 * during render would use the server's locale and timezone during SSR and the
 * browser's on hydration — a mismatch, and a wrong date for anyone whose stored
 * timezone is not the server's. The page formats them once, on the server,
 * where `user.timezone` is known.
 */
export type ProblemRecordView = {
  status: string | null;
  totalAttempts: number;
  /** Already through `formatElapsed`; locale-independent, so it is safe either side. */
  bestTime: string | null;
  firstSolved: string | null;
  lastAttempted: string | null;
  confidence: string | null;
};

export type ProblemPanelView = {
  title: string;
  difficulty: 'easy' | 'medium' | 'hard';
  topics: string[];
  /**
   * Pattern tags — fetched by `getProblemBySlug` since F1.1 and, until now,
   * dropped on the floor. The page filtered `tags` down to `topic` and threw
   * the rest away, so this is recovering data the query already paid for
   * rather than asking for more.
   */
  patterns: string[];
  /** Present only for original problems. C1 forbids it for external ones. */
  statement: string | null;
  externalUrl: string | null;
  platform: string | null;
  estimatedMinutes: number;
  isPremium: boolean;
  /**
   * Null when nobody is signed in — which is not the same as "no attempts yet",
   * and the panel renders the two differently.
   */
  record: ProblemRecordView | null;
  native: NativeProblemPanelView | null;
};

type Tab = 'description' | 'editorial' | 'submissions';

export function ProblemPanel({
  problem,
  submissions,
}: {
  problem: ProblemPanelView;
  /** F1.5's attempt history, rendered by its own component. */
  submissions: React.ReactNode;
}) {
  const [tab, setTab] = useState<Tab>('description');

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 gap-0.5 border-b border-[var(--border)] px-2">
        {(['description', 'editorial', 'submissions'] as const).map((value) => (
          <button
            aria-current={tab === value}
            className={`-mb-px border-b-2 px-2.5 py-2 text-[0.8125rem] font-medium transition-colors ${
              tab === value
                ? 'border-[var(--accent)] text-[var(--text-primary)]'
                : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-primary)]'
            }`}
            key={value}
            onClick={() => setTab(value)}
            type="button"
          >
            {value === 'description'
              ? 'Description'
              : value === 'editorial'
                ? 'Editorial'
                : 'Submissions'}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-3.5 py-3.5">
        {tab === 'description' ? (
          <div className="flex flex-col gap-4">
            <div>
              {/*
                One step above body copy, not three. The title was `text-xl`
                against `text-sm` content, which read as a page heading dropped
                into a sidebar rather than the top of a dense panel.
              */}
              <h1 className="text-base leading-snug font-semibold tracking-tight">
                {problem.title}
              </h1>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <DifficultyPill difficulty={problem.difficulty} />
                <TopicChips interactive topics={problem.topics} />
                {problem.isPremium ? (
                  <span className="rounded-full border border-[var(--accent)] px-2 py-0.5 text-xs font-medium text-[var(--accent)]">
                    Premium
                  </span>
                ) : null}
                {/*
                  An estimate, and it says so. A bare "20m" beside a difficulty
                  pill reads as a limit, which is the opposite of the point —
                  nothing on this screen is timed against it.
                */}
                <span className="text-xs text-[var(--text-muted)]">
                  ~{problem.estimatedMinutes}m estimated
                </span>
              </div>
              {problem.native?.companies.length ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  {problem.native.companies.map((company) => (
                    <Link
                      className="rounded-full border border-[var(--border)] px-2.5 py-1 text-xs text-[var(--text-muted)]"
                      href={`/companies/${company.slug}`}
                      key={`${company.slug}-${company.evidenceType}`}
                    >
                      {company.name} · {EVIDENCE_TYPE_LABELS[company.evidenceType]}
                    </Link>
                  ))}
                </div>
              ) : null}
            </div>

            {problem.statement ? (
              /*
                An original problem (C2 — the text is ours). Split on blank
                lines and render each block as a text node; no markdown parser,
                no HTML.
              */
              <div className="flex flex-col gap-5 text-sm leading-relaxed">
                {problem.native ? (
                  <p className="rounded-[var(--radius)] bg-[var(--surface-raised)] p-3 text-[var(--text-muted)]">
                    {problem.native.story}
                  </p>
                ) : null}
                {problem.statement.split(/\n\s*\n/).map((block, index) => (
                  <p key={`block-${index}`} className="whitespace-pre-wrap">
                    {block}
                  </p>
                ))}

                {problem.native ? (
                  <>
                    <section>
                      <h2 className="mb-2 font-semibold">Function contract</h2>
                      <code className="block rounded-[var(--radius)] bg-[var(--surface-raised)] p-3 text-xs">
                        {problem.native.functionContract.functionName}(
                        {problem.native.functionContract.parameters
                          .map((parameter) => `${parameter.name}: ${parameter.type}`)
                          .join(', ')}
                        ) → {problem.native.functionContract.returnType}
                      </code>
                    </section>

                    <section className="grid gap-3 sm:grid-cols-2">
                      <div>
                        <h2 className="mb-1 font-semibold">Input</h2>
                        <p className="whitespace-pre-wrap text-[var(--text-muted)]">
                          {problem.native.inputFormat}
                        </p>
                      </div>
                      <div>
                        <h2 className="mb-1 font-semibold">Output</h2>
                        <p className="whitespace-pre-wrap text-[var(--text-muted)]">
                          {problem.native.outputFormat}
                        </p>
                      </div>
                    </section>

                    <section>
                      <h2 className="mb-2 font-semibold">Examples</h2>
                      <div className="flex flex-col gap-3">
                        {problem.native.examples.map((example, index) => (
                          <div
                            className="rounded-[var(--radius)] border border-[var(--border)] p-3"
                            key={`example-${index}`}
                          >
                            <p className="font-medium">Example {index + 1}</p>
                            <pre className="mt-2 overflow-auto rounded bg-[var(--surface-raised)] p-2 text-xs">
                              Input: {example.input}
                              {'\n'}Output: {example.output}
                            </pre>
                            <p className="mt-2 text-[var(--text-muted)]">
                              {example.explanation}
                            </p>
                          </div>
                        ))}
                      </div>
                    </section>

                    <section>
                      <h2 className="mb-2 font-semibold">Constraints</h2>
                      <ul className="list-disc space-y-1 pl-5 text-[var(--text-muted)]">
                        {problem.native.constraints.map((constraint) => (
                          <li key={constraint}>{constraint}</li>
                        ))}
                      </ul>
                    </section>

                    <details className="rounded-[var(--radius)] border border-[var(--border)] p-3">
                      <summary className="cursor-pointer font-medium">Hints</summary>
                      <ol className="mt-3 list-decimal space-y-2 pl-5 text-[var(--text-muted)]">
                        {problem.native.hints.map((hint) => (
                          <li key={hint}>{hint}</li>
                        ))}
                      </ol>
                    </details>
                  </>
                ) : null}
              </div>
            ) : (
              <div className="flex flex-col gap-4 text-sm">
                <p className="text-[var(--text-muted)]">
                  This problem is hosted on {problem.platform ?? 'another platform'}, so its
                  statement lives there. Quadrantcode records how you solve it, not what it
                  says.
                </p>

                {problem.externalUrl ? (
                  /*
                    An outline, not a fill. This was the only saturated block of
                    colour on the screen and it read as foreign because of it —
                    `--accent` is the one token pair with a measured text-on-fill
                    ratio, so it had become the default for every solid button
                    regardless of meaning. The single fill on this screen now
                    belongs to Solved, which is the action that ends something.
                  */
                  <Link
                    className="inline-flex items-center gap-1.5 self-start rounded-[var(--radius)] border border-[var(--border)] px-2.5 py-1.5 font-medium text-[var(--accent)] transition-colors hover:border-[var(--accent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
                    href={problem.externalUrl}
                    rel="noreferrer noopener"
                    target="_blank"
                  >
                    Read it on {problem.platform ?? 'the original site'}
                    <span aria-hidden="true">↗</span>
                  </Link>
                ) : null}

                <ProblemRecord record={problem.record} />
                <RelatedTags patterns={problem.patterns} topics={problem.topics} />
              </div>
            )}
          </div>
        ) : tab === 'editorial' ? (
          problem.native?.editorial ? (
            <div className="flex flex-col gap-5 text-sm leading-relaxed">
              <EditorialSection title="Overview" value={problem.native.editorial.overview} />
              {problem.native.editorial.bruteForceApproach ? (
                <EditorialSection
                  title="Brute-force approach"
                  value={problem.native.editorial.bruteForceApproach}
                />
              ) : null}
              <EditorialSection
                title="Optimal approach"
                value={problem.native.editorial.optimalApproach}
              />
              <EditorialSection
                title="Why it works"
                value={problem.native.editorial.correctnessProof}
              />
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-[var(--radius)] bg-[var(--surface-raised)] p-3">
                  <p className="text-xs uppercase tracking-wide text-[var(--text-muted)]">
                    Time
                  </p>
                  <p className="mt-1 font-mono">{problem.native.editorial.timeComplexity}</p>
                </div>
                <div className="rounded-[var(--radius)] bg-[var(--surface-raised)] p-3">
                  <p className="text-xs uppercase tracking-wide text-[var(--text-muted)]">
                    Space
                  </p>
                  <p className="mt-1 font-mono">{problem.native.editorial.spaceComplexity}</p>
                </div>
              </div>
            </div>
          ) : (
            <p className="text-sm text-[var(--text-muted)]">
              No editorial is published for this problem yet.
            </p>
          )
        ) : (
          submissions
        )}
      </div>

      {/*
        The footer rail, and the reason the panel stops rather than trails off.
        It mirrors the execution-limits strip anchoring the right pane, so both
        columns terminate on a deliberate line instead of running out of
        content — which is what made the empty lower half read as a void.

        The wording is unchanged and deliberately so: "scratchpad" is asserted
        by e2e/execution.spec.ts, and there is no "on the right" here because
        below `md` the panes stack and the editor is underneath this, so a
        direction would simply be wrong on a phone.
      */}
      <p className="shrink-0 border-t border-[var(--border)] px-3.5 py-2 text-xs text-[var(--text-muted)]">
        {problem.statement
          ? 'Your session, stuck points and run attempts are recorded as you work.'
          : 'The editor is a scratchpad — nothing you run here is checked against that platform’s tests.'}
      </p>
    </div>
  );
}

/**
 * Ways out of this problem and into the catalog.
 *
 * Patterns only. The topic chips in the header are already links into the
 * filtered catalog, so repeating them here would be the same navigation twice;
 * `pattern` is the tag type that has been fetched since F1.1 and rendered
 * nowhere.
 *
 * Renders nothing when a problem carries no pattern tags — a heading over an
 * empty row is worse than no heading. This section is therefore a bonus, not
 * the fix for the empty panel: the surface and the footer rail are what make
 * the column read as a container.
 */
function RelatedTags({ patterns, topics }: { patterns: string[]; topics: string[] }) {
  if (patterns.length === 0) return null;

  return (
    <section>
      <h2 className="mb-2 text-xs font-medium tracking-wide text-[var(--text-muted)] uppercase">
        Patterns
      </h2>
      <div className="flex flex-wrap gap-1.5">
        {patterns.map((pattern) => (
          <Link
            className="rounded-full border border-[var(--border)] px-2.5 py-0.5 text-xs text-[var(--text-muted)] transition-colors hover:border-[var(--accent)] hover:text-[var(--text-primary)]"
            href={`/problems?pattern=${encodeURIComponent(pattern)}`}
            key={pattern}
          >
            {pattern}
          </Link>
        ))}
      </div>
      {topics[0] ? (
        <p className="mt-2 text-xs text-[var(--text-muted)]">
          Or browse everything tagged{' '}
          <Link
            className="text-[var(--accent)] hover:underline"
            href={`/problems?topic=${encodeURIComponent(topics[0])}`}
          >
            {topics[0]}
          </Link>
          .
        </p>
      ) : null}
    </section>
  );
}

/**
 * The reader's own standing on this problem.
 *
 * ## A summary, not a second timeline
 *
 * The Submissions tab already renders every sitting through `AttemptHistory`.
 * This reads the aggregate `user_problems` row instead — one line per fact
 * rather than one per attempt. Restating the timeline here would make that tab
 * redundant and this pane endless.
 *
 * ## Three states, not two
 *
 * Signed out is not the same as "no attempts yet". A signed-out reader gets
 * nothing at all, because there is no record and inviting them to start one
 * they cannot save would be a lie. A signed-in reader with no history gets an
 * invitation — never a table of dashes, which reads as broken rather than new.
 *
 * Rows are omitted when empty rather than shown as "—": a problem you have
 * attempted but never solved has no "first solved" date, and printing the
 * label with a dash draws the eye to an absence that is completely normal.
 */
function ProblemRecord({ record }: { record: ProblemRecordView | null }) {
  if (!record) return null;

  if (record.totalAttempts === 0 && !record.lastAttempted) {
    return (
      <section className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface-raised)] p-3">
        <h2 className="text-xs font-medium tracking-wide text-[var(--text-muted)] uppercase">
          Your record
        </h2>
        <p className="mt-1.5 text-[var(--text-muted)]">
          You haven&apos;t started a sitting on this one yet. Start the timer before you read
          the statement — the first minutes are the ones worth measuring.
        </p>
      </section>
    );
  }

  const rows: Array<{ label: string; value: React.ReactNode }> = [
    { label: 'Status', value: <StatusMark showLabel status={record.status} /> },
    { label: 'Attempts', value: <span className="tabular-nums">{record.totalAttempts}</span> },
  ];

  if (record.bestTime) {
    rows.push({
      label: 'Best time',
      value: <span className="font-mono tabular-nums">{record.bestTime}</span>,
    });
  }
  if (record.firstSolved) rows.push({ label: 'First solved', value: record.firstSolved });
  if (record.lastAttempted) rows.push({ label: 'Last attempted', value: record.lastAttempted });
  if (record.confidence) rows.push({ label: 'Confidence', value: record.confidence });

  return (
    <section className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface-raised)] p-3">
      <h2 className="text-xs font-medium tracking-wide text-[var(--text-muted)] uppercase">
        Your record
      </h2>
      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-5 gap-y-1.5 text-[0.8125rem]">
        {rows.map((row) => (
          <Fragment key={row.label}>
            <dt className="text-[var(--text-muted)]">{row.label}</dt>
            <dd>{row.value}</dd>
          </Fragment>
        ))}
      </dl>
    </section>
  );
}

function EditorialSection({ title, value }: { title: string; value: string }) {
  return (
    <section>
      <h2 className="mb-2 font-semibold">{title}</h2>
      {value.split(/\n\s*\n/).map((block, index) => (
        <p
          className="mb-2 whitespace-pre-wrap text-[var(--text-muted)]"
          key={`${title}-${index}`}
        >
          {block}
        </p>
      ))}
    </section>
  );
}
