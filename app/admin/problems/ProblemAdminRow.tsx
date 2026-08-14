'use client';

import { useTransition } from 'react';
import { archiveProblemAction, unarchiveProblemAction } from './actions';

/** One catalog row with its archive toggle. */
export function ProblemAdminRow({
  id,
  slug,
  title,
  sourceType,
  difficulty,
  status,
}: {
  id: string;
  slug: string;
  title: string;
  sourceType: string;
  difficulty: string;
  status: string;
}) {
  const [pending, startTransition] = useTransition();
  const archived = status === 'archived';

  function toggle() {
    startTransition(async () => {
      await (archived ? unarchiveProblemAction(id) : archiveProblemAction(id));
    });
  }

  return (
    <tr className="border-b border-[var(--border)] last:border-0">
      <td className="px-3 py-2">
        <a
          className="text-[var(--accent)] underline-offset-2 hover:underline"
          href={`/problems/${slug}`}
        >
          {title}
        </a>
      </td>
      <td className="px-3 py-2 text-[var(--text-muted)]">
        {sourceType === 'external_link' ? 'external' : 'original'}
      </td>
      <td className="px-3 py-2">{difficulty}</td>
      <td className="px-3 py-2">
        <span className={archived ? 'text-[var(--warning)]' : 'text-[var(--text-muted)]'}>
          {status}
        </span>
      </td>
      <td className="px-3 py-2">
        <button
          className="rounded-[var(--radius)] border border-[var(--border)] px-2 py-1 text-xs disabled:opacity-60"
          disabled={pending}
          onClick={toggle}
          type="button"
        >
          {pending ? 'Saving…' : archived ? 'Restore' : 'Archive'}
        </button>
      </td>
    </tr>
  );
}
