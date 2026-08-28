/**
 * The health dashboard.
 *
 * Admin-only — `app/admin/layout.tsx` enforces the role, so this page does not
 * repeat the check. Unlike `/api/health` it shows the DETAIL lines, because the
 * person reading it is entitled to know why something is absent.
 *
 * ## Panels the ticket asks for that are not here
 *
 * Queue depths, dead-letter counts, Razorpay webhook failures, AI spend. F2.3,
 * F4.4 and F3.4 are cut, so there is nothing behind any of them. A panel
 * reporting `0` would be a number that looks measured — they are listed as
 * absent instead, with the reason.
 */
import { PageHeader } from '@/components/ui/PageHeader';
import { getDb } from '@/server/db';
import { checkHealth, recentAudit } from '@/server/lib/observability';

const ABSENT_PANELS: { name: string; why: string }[] = [
  { name: 'Queue depth and dead letters', why: 'F2.3 is cut — there is no queue' },
  { name: 'Judge0 success rate and p95', why: 'no JUDGE0_URL — nothing has ever run' },
  { name: 'Notification delivery rate', why: 'F2.4 is cut — nothing sends notifications' },
  { name: 'AI spend against budget', why: 'F3.4 is cut — nothing calls a model' },
  { name: 'Razorpay webhook failures', why: 'F4.4 is cut — there are no webhooks' },
];

const STATE_TOKEN: Record<string, string> = {
  up: 'var(--success)',
  down: 'var(--danger)',
  not_configured: 'var(--warning)',
};

export default async function HealthPage() {
  const db = getDb();
  const now = new Date();

  const [report, audit] = await Promise.all([
    checkHealth(db, process.env, now),
    recentAudit(db, 20),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        description={`Checked ${report.checkedAt.toISOString().slice(0, 19).replace('T', ' ')} · overall: ${report.status}`}
        title="Health"
      />

      <section>
        <h2 className="mb-2 text-sm font-medium">Dependencies</h2>
        <ul aria-label="Dependency health" className="flex flex-col gap-2">
          {report.dependencies.map((entry) => (
            <li
              className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-3"
              key={entry.name}
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-medium">{entry.name}</span>
                <span
                  className="text-sm font-medium"
                  style={{ color: STATE_TOKEN[entry.state] ?? 'var(--text-muted)' }}
                >
                  {entry.state.replace(/_/g, ' ')}
                  {entry.latencyMs === null ? '' : ` · ${entry.latencyMs} ms`}
                </span>
              </div>
              {/* Never a bare state. Why it is absent is the useful half. */}
              <p className="mt-0.5 text-sm text-[var(--text-muted)]">{entry.detail}</p>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-medium">Not measured</h2>
        <p className="mb-2 text-sm text-[var(--text-muted)]">
          The ticket asks for these. Nothing sits behind them, so they are listed rather than
          shown as zero.
        </p>
        <ul className="flex flex-col gap-1 text-sm text-[var(--text-muted)]">
          {ABSENT_PANELS.map((panel) => (
            <li key={panel.name}>
              · {panel.name} — {panel.why}
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-medium">Recent admin actions</h2>
        {audit.length === 0 ? (
          <p className="text-sm text-[var(--text-muted)]">Nothing recorded yet.</p>
        ) : (
          <ul aria-label="Audit log" className="flex flex-col gap-1 text-sm">
            {audit.map((entry) => (
              <li key={entry.id}>
                <span className="font-mono text-xs text-[var(--text-muted)]">
                  {entry.createdAt.toISOString().slice(0, 19).replace('T', ' ')}
                </span>{' '}
                {entry.action} · {entry.target}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
