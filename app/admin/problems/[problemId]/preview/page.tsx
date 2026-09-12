import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/ui/PageHeader';
import { getDb } from '@/server/db';
import { getNativeProblemAdmin } from '@/server/services/admin';

export default async function NativeProblemPreview({
  params,
}: {
  params: Promise<{ problemId: string }>;
}) {
  const { problemId } = await params;
  const detail = await getNativeProblemAdmin(getDb(), problemId);
  if (!detail) notFound();
  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <PageHeader
        eyebrow={`Admin preview · ${detail.problem.status}`}
        title={detail.problem.title}
        description="Safe learner-facing preview. Hidden tests, wrappers and reference solutions are deliberately omitted."
      />
      <Link className="text-sm underline" href={`/admin/problems/${problemId}`}>
        Back to editor
      </Link>
      <article className="prose mt-8 max-w-none">
        <p>{detail.version.story}</p>
        <p>{detail.version.statement}</p>
        <h2>Input</h2>
        <p>{detail.version.inputFormat}</p>
        <h2>Output</h2>
        <p>{detail.version.outputFormat}</p>
        <h2>Examples</h2>
        {detail.examples.map((example) => (
          <section key={example.id}>
            <pre>
              {example.input || '(empty input)'}
              {`\n→ ${example.output}`}
            </pre>
            <p>{example.explanation}</p>
          </section>
        ))}
        <h2>Constraints</h2>
        <ul>
          {detail.version.constraints.map((constraint) => (
            <li key={constraint}>{constraint}</li>
          ))}
        </ul>
        <h2>Hints</h2>
        <ol>
          {detail.version.hints.map((hint) => (
            <li key={hint}>{hint}</li>
          ))}
        </ol>
      </article>
    </main>
  );
}
