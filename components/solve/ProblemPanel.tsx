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

export type ProblemPanelView = {
  title: string;
  difficulty: 'easy' | 'medium' | 'hard';
  topics: string[];
  /** Present only for original problems. C1 forbids it for external ones. */
  statement: string | null;
  externalUrl: string | null;
  platform: string | null;
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
      <div className="flex gap-1 border-b border-[var(--border)] px-4">
        {(['description', 'editorial', 'submissions'] as const).map((value) => (
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
            {value === 'description'
              ? 'Description'
              : value === 'editorial'
                ? 'Editorial'
                : 'Submissions'}
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
              <div className="flex flex-col gap-3 text-sm text-[var(--text-muted)]">
                <p>
                  This problem is hosted on {problem.platform ?? 'another platform'}, so its
                  statement lives there. Quadrantcode records how you solve it, not what it
                  says.
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
    </div>
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
