'use client';

/**
 * The left pane: what the problem is, and how you have done on it.
 *
 * ## Why the Description tab is thin for most problems
 *
 * Every problem in the catalog today is `external_link`, and **C1 means we hold
 * metadata and a link, never a statement** — enforced by the database, not just
 * by intent. So this pane shows what actually exists: difficulty, topics, your
 * own history, and a prominent way out to the platform that does have the text.
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
import { useState } from 'react';
import Link from 'next/link';
import { DifficultyPill } from './DifficultyPill';
import { TopicChips } from './TopicChips';

export type ProblemPanelView = {
  title: string;
  difficulty: 'easy' | 'medium' | 'hard';
  topics: string[];
  /** Present only for original problems. C1 forbids it for external ones. */
  statement: string | null;
  externalUrl: string | null;
  platform: string | null;
};

type Tab = 'description' | 'submissions';

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
      <div className="flex gap-1 border-b border-[var(--border)] px-4">
        {(['description', 'submissions'] as const).map((value) => (
          <button
            aria-current={tab === value}
            className={`border-b-2 px-3 py-2 text-sm transition-colors ${
              tab === value
                ? 'border-[var(--accent)] text-[var(--text-primary)]'
                : 'border-transparent text-[var(--text-muted)]'
            }`}
            key={value}
            onClick={() => setTab(value)}
            type="button"
          >
            {value === 'description' ? 'Description' : 'Submissions'}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-4">
        {tab === 'description' ? (
          <div className="flex flex-col gap-4">
            <div>
              <h1 className="text-xl font-semibold">{problem.title}</h1>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <DifficultyPill difficulty={problem.difficulty} />
                <TopicChips interactive topics={problem.topics} />
              </div>
            </div>

            {problem.statement ? (
              /*
                An original problem (C2 — the text is ours). Split on blank
                lines and render each block as a text node; no markdown parser,
                no HTML.
              */
              <div className="flex flex-col gap-3 text-sm leading-relaxed">
                {problem.statement.split(/\n\s*\n/).map((block, index) => (
                  <p key={`block-${index}`} className="whitespace-pre-wrap">
                    {block}
                  </p>
                ))}
              </div>
            ) : (
              <div className="flex flex-col gap-3 text-sm text-[var(--text-muted)]">
                <p>
                  This problem is hosted on {problem.platform ?? 'another platform'}, so its
                  statement lives there. TraceLoop records how you solve it, not what it says.
                </p>

                {problem.externalUrl ? (
                  <p>
                    <Link
                      className="inline-block rounded-[var(--radius)] bg-[var(--accent)] px-3 py-1.5 font-medium text-[var(--accent-foreground)]"
                      href={problem.externalUrl}
                      rel="noreferrer noopener"
                      target="_blank"
                    >
                      Read it on {problem.platform ?? 'the original site'} ↗
                    </Link>
                  </p>
                ) : null}

                {/*
                  No "on the right". Below `md` the panes stack and the editor
                  is underneath this paragraph, so a direction is simply wrong
                  on a phone — and directional copy is the kind of thing that
                  survives a layout change unnoticed because nothing asserts it.
                */}
                <p className="text-xs">
                  The editor is a scratchpad — nothing you run here is checked against that
                  platform&rsquo;s tests.
                </p>
              </div>
            )}
          </div>
        ) : (
          submissions
        )}
      </div>
    </div>
  );
}
