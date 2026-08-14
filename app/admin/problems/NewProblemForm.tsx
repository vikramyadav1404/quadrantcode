'use client';

/**
 * Admin create form.
 *
 * F1.1 requirement 4: ONE Zod schema, TWO consumers. This form parses the
 * payload with `createProblemSchema` before submitting, and the server action
 * parses it again with the same schema. The client parse exists to give fast,
 * field-level feedback — it is not a security boundary, because the action can
 * be called without ever loading this form.
 *
 * The C1 demonstration matters here: the statement textarea is only offered
 * for an ORIGINAL problem. Switching the source type to external-link hides it
 * AND clears it, so an admin cannot type a statement, switch type, and submit.
 */
import { useState, useTransition } from 'react';
import { createProblemSchema } from '@/lib/problems/schemas';
import { createProblemAction } from './actions';

type SourceType = 'external_link' | 'original';

const EMPTY = {
  slug: '',
  title: '',
  platform: 'leetcode',
  externalUrl: '',
  difficulty: 'medium' as const,
  estimatedMinutes: 30,
  statement: '',
  topics: '',
};

export function NewProblemForm() {
  const [sourceType, setSourceType] = useState<SourceType>('external_link');
  const [values, setValues] = useState(EMPTY);
  const [errors, setErrors] = useState<string[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function set<K extends keyof typeof EMPTY>(key: K, value: (typeof EMPTY)[K]) {
    setValues((current) => ({ ...current, [key]: value }));
  }

  function changeSourceType(next: SourceType) {
    setSourceType(next);
    // Clearing rather than merely hiding: a hidden-but-populated field would
    // still be submitted, and the service would reject it — confusingly.
    if (next === 'external_link') set('statement', '');
  }

  function submit() {
    setErrors([]);
    setMessage(null);

    const tags = values.topics
      .split(',')
      .map((topic) => topic.trim().toLowerCase())
      .filter(Boolean)
      .map((tagValue) => ({ tagType: 'topic' as const, tagValue }));

    const payload =
      sourceType === 'external_link'
        ? {
            sourceType,
            slug: values.slug,
            title: values.title,
            platform: values.platform,
            externalUrl: values.externalUrl,
            difficulty: values.difficulty,
            estimatedMinutes: Number(values.estimatedMinutes),
            status: 'published' as const,
            tags,
          }
        : {
            sourceType,
            slug: values.slug,
            title: values.title,
            difficulty: values.difficulty,
            estimatedMinutes: Number(values.estimatedMinutes),
            status: 'draft' as const,
            statement: values.statement || undefined,
            tags,
          };

    // Consumer #1 of the shared schema.
    const parsed = createProblemSchema.safeParse(payload);
    if (!parsed.success) {
      setErrors(
        parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`),
      );
      return;
    }

    startTransition(async () => {
      // Consumer #2 re-parses the same payload server-side.
      const result = await createProblemAction(payload);
      if (result.ok) {
        setValues(EMPTY);
        setMessage('Problem created.');
      } else {
        setErrors([result.message]);
      }
    });
  }

  const field =
    'w-full rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm';

  return (
    <section className="rounded-[var(--radius)] border border-[var(--border)] p-4">
      <h2 className="mb-4 text-lg font-semibold">New problem</h2>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className="mb-1 block text-sm" htmlFor="sourceType">
            Source
          </label>
          <select
            className={field}
            id="sourceType"
            onChange={(event) => changeSourceType(event.target.value as SourceType)}
            value={sourceType}
          >
            <option value="external_link">External link (metadata + link only)</option>
            <option value="original">Original (our own text)</option>
          </select>
        </div>

        <div>
          <label className="mb-1 block text-sm" htmlFor="title">
            Title
          </label>
          <input
            className={field}
            id="title"
            onChange={(event) => set('title', event.target.value)}
            value={values.title}
          />
        </div>

        <div>
          <label className="mb-1 block text-sm" htmlFor="slug">
            Slug
          </label>
          <input
            className={field}
            id="slug"
            onChange={(event) => set('slug', event.target.value)}
            placeholder="two-sum"
            value={values.slug}
          />
        </div>

        {sourceType === 'external_link' ? (
          <>
            <div>
              <label className="mb-1 block text-sm" htmlFor="platform">
                Platform
              </label>
              <input
                className={field}
                id="platform"
                onChange={(event) => set('platform', event.target.value)}
                value={values.platform}
              />
            </div>
            <div>
              <label className="mb-1 block text-sm" htmlFor="externalUrl">
                Problem URL
              </label>
              <input
                className={field}
                id="externalUrl"
                onChange={(event) => set('externalUrl', event.target.value)}
                placeholder="https://leetcode.com/problems/two-sum/"
                value={values.externalUrl}
              />
            </div>
          </>
        ) : (
          <div className="sm:col-span-2">
            <label className="mb-1 block text-sm" htmlFor="statement">
              Statement (markdown, ours)
            </label>
            <textarea
              className={field}
              id="statement"
              onChange={(event) => set('statement', event.target.value)}
              rows={5}
              value={values.statement}
            />
          </div>
        )}

        <div>
          <label className="mb-1 block text-sm" htmlFor="difficulty">
            Difficulty
          </label>
          <select
            className={field}
            id="difficulty"
            onChange={(event) =>
              set('difficulty', event.target.value as (typeof EMPTY)['difficulty'])
            }
            value={values.difficulty}
          >
            <option value="easy">Easy</option>
            <option value="medium">Medium</option>
            <option value="hard">Hard</option>
          </select>
        </div>

        <div>
          <label className="mb-1 block text-sm" htmlFor="estimatedMinutes">
            Estimated minutes
          </label>
          <input
            className={field}
            id="estimatedMinutes"
            onChange={(event) => set('estimatedMinutes', Number(event.target.value))}
            type="number"
            value={values.estimatedMinutes}
          />
        </div>

        <div className="sm:col-span-2">
          <label className="mb-1 block text-sm" htmlFor="topics">
            Topic tags (comma separated)
          </label>
          <input
            className={field}
            id="topics"
            onChange={(event) => set('topics', event.target.value)}
            placeholder="arrays, hashing"
            value={values.topics}
          />
        </div>
      </div>

      {sourceType === 'external_link' ? (
        <p className="mt-3 text-xs text-[var(--text-muted)]">
          External-link problems store metadata and a link only. Statements, examples and
          editorials stay on the original platform.
        </p>
      ) : null}

      {errors.length > 0 ? (
        <ul aria-live="polite" className="mt-3 space-y-1 text-sm text-[var(--danger)]">
          {errors.map((error) => (
            <li key={error}>{error}</li>
          ))}
        </ul>
      ) : null}

      {message ? (
        <p aria-live="polite" className="mt-3 text-sm text-[var(--success)]">
          {message}
        </p>
      ) : null}

      <button
        className="mt-4 rounded-[var(--radius)] bg-[var(--accent)] px-3 py-2 text-sm font-medium text-[var(--accent-foreground)] disabled:opacity-60"
        disabled={pending}
        onClick={submit}
        type="button"
      >
        {pending ? 'Creating…' : 'Create problem'}
      </button>
    </section>
  );
}
