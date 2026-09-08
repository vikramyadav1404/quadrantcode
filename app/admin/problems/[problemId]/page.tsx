import Link from 'next/link';
import { notFound } from 'next/navigation';
import { EXECUTION_LANGUAGES } from '@/lib/execution/languages';
import { TEST_CASE_COVERAGE, TEST_CASE_VISIBILITIES } from '@/lib/native/constants';
import { PageHeader } from '@/components/ui/PageHeader';
import { getDb } from '@/server/db';
import { getNativeProblemAdmin } from '@/server/services/admin';
import {
  publishNativeProblemAction,
  sendNativeProblemToReviewAction,
  updateNativeEditorialAction,
  updateNativeExampleAction,
  updateNativeLanguageTemplateAction,
  updateNativeProblemCoreAction,
  updateNativeTestCaseAction,
  validateNativeProblemReferencesAction,
} from './actions';

export default async function NativeProblemAdminPage({
  params,
}: {
  params: Promise<{ problemId: string }>;
}) {
  const { problemId } = await params;
  const detail = await getNativeProblemAdmin(getDb(), problemId);
  if (!detail) notFound();
  const editable = !['published', 'archived'].includes(detail.version.status);

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <PageHeader
        eyebrow={`Native v${detail.version.version} · ${detail.version.status}`}
        title={detail.problem.title}
        description="Admin-only content, protected tests, reference validation, and publication workflow."
      />
      <div className="mb-6 flex flex-wrap gap-3 text-sm">
        <Link className="underline" href="/admin/problems">
          Back to problems
        </Link>
        <Link className="underline" href={`/admin/problems/${problemId}/preview`}>
          Safe preview
        </Link>
        {detail.problem.status === 'published' ? (
          <Link className="underline" href={`/problems/${detail.problem.slug}`}>
            Public page
          </Link>
        ) : null}
      </div>

      <section className="rounded-[var(--radius-lg)] border border-[var(--border)] p-5">
        <h2 className="text-lg font-semibold">Core content and calibration</h2>
        <form action={updateNativeProblemCoreAction} className="mt-4 grid gap-4">
          <input name="problemId" type="hidden" value={problemId} />
          <Field label="Title">
            <input
              className={inputClass}
              defaultValue={detail.problem.title}
              disabled={!editable}
              name="title"
              required
            />
          </Field>
          <div className="grid gap-4 md:grid-cols-3">
            <Field label="Difficulty">
              <select
                className={inputClass}
                defaultValue={detail.problem.difficulty}
                disabled={!editable}
                name="difficulty"
              >
                {['easy', 'medium', 'hard'].map((value) => (
                  <option key={value}>{value}</option>
                ))}
              </select>
            </Field>
            <Field label="Calibration (-2 to 2)">
              <input
                className={inputClass}
                defaultValue={detail.problem.difficultyCalibration}
                disabled={!editable}
                max={2}
                min={-2}
                name="difficultyCalibration"
                type="number"
              />
            </Field>
            <Field label="Estimated minutes">
              <input
                className={inputClass}
                defaultValue={detail.problem.estimatedMinutes}
                disabled={!editable}
                name="estimatedMinutes"
                type="number"
              />
            </Field>
          </div>
          <Field label="Story">
            <textarea
              className={textareaClass}
              defaultValue={detail.version.story}
              disabled={!editable}
              name="story"
            />
          </Field>
          <Field label="Statement">
            <textarea
              className={textareaClass}
              defaultValue={detail.version.statement}
              disabled={!editable}
              name="statement"
            />
          </Field>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Input format">
              <textarea
                className={textareaClass}
                defaultValue={detail.version.inputFormat}
                disabled={!editable}
                name="inputFormat"
              />
            </Field>
            <Field label="Output format">
              <textarea
                className={textareaClass}
                defaultValue={detail.version.outputFormat}
                disabled={!editable}
                name="outputFormat"
              />
            </Field>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Constraints (one per line)">
              <textarea
                className={textareaClass}
                defaultValue={detail.version.constraints.join('\n')}
                disabled={!editable}
                name="constraints"
              />
            </Field>
            <Field label="Hints (one per line)">
              <textarea
                className={textareaClass}
                defaultValue={detail.version.hints.join('\n')}
                disabled={!editable}
                name="hints"
              />
            </Field>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Time limit (ms)">
              <input
                className={inputClass}
                defaultValue={detail.version.timeLimitMs}
                disabled={!editable}
                name="timeLimitMs"
                type="number"
              />
            </Field>
            <Field label="Memory limit (KB)">
              <input
                className={inputClass}
                defaultValue={detail.version.memoryLimitKb}
                disabled={!editable}
                name="memoryLimitKb"
                type="number"
              />
            </Field>
          </div>
          <Field label="Review notes">
            <textarea
              className={textareaClass}
              defaultValue={detail.version.reviewNotes ?? ''}
              disabled={!editable}
              name="reviewNotes"
            />
          </Field>
          <button className={buttonClass} disabled={!editable} type="submit">
            Save and return to needs review
          </button>
        </form>
      </section>

      <section className="mt-6 rounded-[var(--radius-lg)] border border-[var(--border)] p-5">
        <h2 className="text-lg font-semibold">Protected publication workflow</h2>
        <p className="mt-2 text-sm text-[var(--text-muted)]">
          Local content generation never publishes automatically. A real external Judge0
          provider must validate the current reference/template/test hash before publication.
        </p>
        <div className="mt-4 grid gap-4 md:grid-cols-3">
          <form action={sendNativeProblemToReviewAction}>
            <input name="problemId" type="hidden" value={problemId} />
            <button
              className={buttonClass}
              disabled={!['draft', 'needs_review'].includes(detail.version.status)}
            >
              1. Send to review
            </button>
          </form>
          <form action={validateNativeProblemReferencesAction}>
            <input name="problemId" type="hidden" value={problemId} />
            <button className={buttonClass} disabled={detail.version.status !== 'review'}>
              2. Validate on Judge0
            </button>
          </form>
          <form action={publishNativeProblemAction} className="grid gap-2 text-xs">
            <input name="problemId" type="hidden" value={problemId} />
            {[
              ['originalityConfirmed', 'Original wording/provenance checked'],
              ['samplesConfirmed', 'Samples/explanations checked'],
              ['constraintsConfirmed', 'Limits and edge coverage checked'],
              ['evidenceConfirmed', 'Company evidence labels checked'],
            ].map(([name, label]) => (
              <label className="flex gap-2" key={name}>
                <input name={name} type="checkbox" />
                {label}
              </label>
            ))}
            <button className={buttonClass} disabled={detail.version.status !== 'tested'}>
              3. Publish
            </button>
          </form>
        </div>
        <dl className="mt-4 grid gap-2 text-sm md:grid-cols-3">
          <div>
            <dt className="text-[var(--text-muted)]">Validated</dt>
            <dd>{detail.version.referenceValidatedAt?.toISOString() ?? 'Not yet'}</dd>
          </div>
          <div>
            <dt className="text-[var(--text-muted)]">Provider</dt>
            <dd>{detail.version.referenceValidationProvider ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-[var(--text-muted)]">License</dt>
            <dd>{detail.license.licenseName}</dd>
          </div>
        </dl>
      </section>

      <section className="mt-6 rounded-[var(--radius-lg)] border border-[var(--border)] p-5">
        <h2 className="text-lg font-semibold">Explained examples</h2>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          {detail.examples.map((example) => (
            <form
              action={updateNativeExampleAction}
              className="grid gap-3 rounded-[var(--radius)] border border-[var(--border)] p-4"
              key={example.id}
            >
              <input name="problemId" type="hidden" value={problemId} />
              <input name="exampleId" type="hidden" value={example.id} />
              <Field label={`Example ${example.ordinal} input`}>
                <textarea
                  className={codeClass}
                  defaultValue={example.input}
                  disabled={!editable}
                  name="input"
                />
              </Field>
              <Field label="Output">
                <textarea
                  className={codeClass}
                  defaultValue={example.output}
                  disabled={!editable}
                  name="output"
                />
              </Field>
              <Field label="Explanation">
                <textarea
                  className={textareaClass}
                  defaultValue={example.explanation}
                  disabled={!editable}
                  name="explanation"
                />
              </Field>
              <button className={buttonClass} disabled={!editable}>
                Save example
              </button>
            </form>
          ))}
        </div>
      </section>

      {detail.editorial ? (
        <section className="mt-6 rounded-[var(--radius-lg)] border border-[var(--border)] p-5">
          <h2 className="text-lg font-semibold">Editorial and proof</h2>
          <form action={updateNativeEditorialAction} className="mt-4 grid gap-3">
            <input name="problemId" type="hidden" value={problemId} />
            <input name="editorialId" type="hidden" value={detail.editorial.id} />
            <Field label="Overview">
              <textarea
                className={textareaClass}
                defaultValue={detail.editorial.overview}
                disabled={!editable}
                name="overview"
              />
            </Field>
            <Field label="Brute-force approach">
              <textarea
                className={textareaClass}
                defaultValue={detail.editorial.bruteForceApproach ?? ''}
                disabled={!editable}
                name="bruteForceApproach"
              />
            </Field>
            <Field label="Optimal approach">
              <textarea
                className={textareaClass}
                defaultValue={detail.editorial.optimalApproach}
                disabled={!editable}
                name="optimalApproach"
              />
            </Field>
            <Field label="Correctness proof">
              <textarea
                className={textareaClass}
                defaultValue={detail.editorial.correctnessProof}
                disabled={!editable}
                name="correctnessProof"
              />
            </Field>
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="Time complexity">
                <input
                  className={inputClass}
                  defaultValue={detail.editorial.timeComplexity}
                  disabled={!editable}
                  name="timeComplexity"
                />
              </Field>
              <Field label="Space complexity">
                <input
                  className={inputClass}
                  defaultValue={detail.editorial.spaceComplexity}
                  disabled={!editable}
                  name="spaceComplexity"
                />
              </Field>
            </div>
            <button className={buttonClass} disabled={!editable}>
              Save editorial
            </button>
          </form>
        </section>
      ) : null}

      <section className="mt-6 rounded-[var(--radius-lg)] border border-[var(--border)] p-5">
        <h2 className="text-lg font-semibold">Language templates and reference solutions</h2>
        <p className="mt-2 text-xs text-[var(--warning)]">
          Sensitive server-only data. Saving any template invalidates previous validation.
        </p>
        <div className="mt-4 grid gap-4">
          {EXECUTION_LANGUAGES.map((language) => {
            const template = detail.templates.find((entry) => entry.language === language);
            if (!template) return <p key={language}>Missing {language} template.</p>;
            return (
              <details
                className="rounded-[var(--radius)] border border-[var(--border)] p-4"
                key={language}
              >
                <summary className="cursor-pointer font-medium">
                  {template.displayName} ·{' '}
                  {template.lastValidatedAt ? 'validated' : 'unvalidated'}
                </summary>
                <form action={updateNativeLanguageTemplateAction} className="mt-4 grid gap-3">
                  <input name="problemId" type="hidden" value={problemId} />
                  <input name="language" type="hidden" value={language} />
                  <Field label="Display name">
                    <input
                      className={inputClass}
                      defaultValue={template.displayName}
                      disabled={!editable}
                      name="displayName"
                    />
                  </Field>
                  <Field label="Function signature">
                    <input
                      className={inputClass}
                      defaultValue={template.functionSignature}
                      disabled={!editable}
                      name="functionSignature"
                    />
                  </Field>
                  <Field label="Starter code">
                    <textarea
                      className={codeClass}
                      defaultValue={template.starterCode}
                      disabled={!editable}
                      name="starterCode"
                    />
                  </Field>
                  <Field label="Server wrapper">
                    <textarea
                      className={codeClass}
                      data-sensitive="execution-wrapper"
                      defaultValue={template.wrapperTemplate}
                      disabled={!editable}
                      name="wrapperTemplate"
                    />
                  </Field>
                  <Field label="Reference solution">
                    <textarea
                      className={codeClass}
                      data-sensitive="reference-solution"
                      defaultValue={template.referenceSolution}
                      disabled={!editable}
                      name="referenceSolution"
                    />
                  </Field>
                  <button className={buttonClass} disabled={!editable}>
                    Save template
                  </button>
                </form>
              </details>
            );
          })}
        </div>
      </section>

      <section className="mt-6 rounded-[var(--radius-lg)] border border-[var(--border)] p-5">
        <h2 className="text-lg font-semibold">Visible and protected hidden tests</h2>
        <p className="mt-2 text-xs text-[var(--warning)]">
          Hidden inputs and expected outputs render only inside this server-authorized admin
          route.
        </p>
        <div className="mt-4 grid gap-4">
          {detail.tests.map((test) => (
            <details
              className="rounded-[var(--radius)] border border-[var(--border)] p-4"
              data-sensitive={test.visibility === 'hidden' ? 'hidden-test' : undefined}
              key={test.id}
            >
              <summary className="cursor-pointer font-medium">
                #{test.ordinal} · {test.visibility} · {test.coverage}
              </summary>
              <form action={updateNativeTestCaseAction} className="mt-4 grid gap-3">
                <input name="problemId" type="hidden" value={problemId} />
                <input name="testCaseId" type="hidden" value={test.id} />
                <div className="grid gap-3 md:grid-cols-2">
                  <Field label="Visibility">
                    <select
                      className={inputClass}
                      defaultValue={test.visibility}
                      disabled={!editable}
                      name="visibility"
                    >
                      {TEST_CASE_VISIBILITIES.map((value) => (
                        <option key={value}>{value}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Coverage">
                    <select
                      className={inputClass}
                      defaultValue={test.coverage}
                      disabled={!editable}
                      name="coverage"
                    >
                      {TEST_CASE_COVERAGE.map((value) => (
                        <option key={value}>{value}</option>
                      ))}
                    </select>
                  </Field>
                </div>
                <Field label="Input">
                  <textarea
                    className={codeClass}
                    defaultValue={test.input}
                    disabled={!editable}
                    name="input"
                  />
                </Field>
                <Field label="Expected output">
                  <textarea
                    className={codeClass}
                    defaultValue={test.expectedOutput}
                    disabled={!editable}
                    name="expectedOutput"
                  />
                </Field>
                <Field label="Explanation">
                  <textarea
                    className={textareaClass}
                    defaultValue={test.explanation ?? ''}
                    disabled={!editable}
                    name="explanation"
                  />
                </Field>
                <label className="flex gap-2 text-sm">
                  <input
                    defaultChecked={test.isPerformance}
                    disabled={!editable}
                    name="isPerformance"
                    type="checkbox"
                  />
                  Performance/stress case
                </label>
                <button className={buttonClass} disabled={!editable}>
                  Save test
                </button>
              </form>
            </details>
          ))}
        </div>
      </section>
    </main>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="grid gap-1 text-sm">
      <span className="font-medium">{label}</span>
      {children}
    </label>
  );
}
const inputClass =
  'min-h-10 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] px-3 py-2';
const textareaClass = `${inputClass} min-h-28`;
const codeClass = `${inputClass} min-h-40 font-mono text-xs`;
const buttonClass =
  'rounded-[var(--radius)] bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50';
