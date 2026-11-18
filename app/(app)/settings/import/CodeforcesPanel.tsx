import {
  connectCodeforcesAction,
  disconnectCodeforcesAction,
  syncCodeforcesAction,
} from './actions';

const button =
  'rounded-[var(--radius)] border border-[var(--border)] px-3 py-2 text-sm hover:border-[var(--accent)]';

/**
 * Codeforces sync. Server-rendered: the forms post to server actions and the
 * page re-renders with the stored outcome, so there is no client state to lose.
 */
export type CodeforcesLinkView = {
  handle: string;
  lastSyncedAt: Date | null;
  lastResult: unknown;
} | null;

export function CodeforcesPanel({ link }: { link: CodeforcesLinkView }) {
  const result = (link?.lastResult ?? null) as {
    error?: string;
    accepted?: number;
    created?: number;
    linked?: number;
    markedSolved?: number;
  } | null;

  return (
    <section className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-4">
      <h2 className="text-base font-semibold">Codeforces sync</h2>
      <p className="mt-1 text-sm text-[var(--text-muted)]">
        Reads your public submissions through Codeforces&apos; official API. Every problem you
        got Accepted is added to your list and marked solved, dated by your first accept.
        Problems you already moved on — solved or due for revision — are left as they are.
        Nothing is posted to Codeforces.
      </p>

      <form action={connectCodeforcesAction} className="mt-3 flex flex-wrap gap-2">
        <input
          aria-label="Codeforces handle"
          autoComplete="off"
          className="min-w-0 flex-1 rounded-[var(--radius)] border border-[var(--border)] bg-transparent px-3 py-2 text-sm"
          defaultValue={link?.handle ?? ''}
          maxLength={24}
          minLength={3}
          name="handle"
          pattern="[A-Za-z0-9_.\-]{3,24}"
          placeholder="Your Codeforces handle"
          required
        />
        <button className={button} type="submit">
          {link ? 'Save and sync' : 'Connect and sync'}
        </button>
      </form>

      {link ? (
        <div className="mt-3 flex flex-col gap-2 text-sm">
          {result?.error ? (
            <p className="text-[var(--danger)]">{result.error}</p>
          ) : result ? (
            <p className="text-[var(--text-muted)]">
              Last sync: {result.accepted} accepted problems · {result.created} new ·{' '}
              {result.linked} from the catalog · {result.markedSolved} marked solved.
            </p>
          ) : null}
          {link.lastSyncedAt ? (
            <p className="text-xs text-[var(--text-muted)]">
              Synced {link.lastSyncedAt.toISOString().slice(0, 16).replace('T', ' ')} UTC. You
              can sync again every 10 minutes.
            </p>
          ) : null}
          <div className="flex gap-2">
            <form action={syncCodeforcesAction}>
              <button className={button} type="submit">
                Sync now
              </button>
            </form>
            <form action={disconnectCodeforcesAction}>
              <button className={button} type="submit">
                Disconnect
              </button>
            </form>
          </div>
        </div>
      ) : null}
    </section>
  );
}
