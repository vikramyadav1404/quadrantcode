import { PageHeader } from '@/components/ui/PageHeader';
import { getDb } from '@/server/db';
import { recentAudit } from '@/server/lib/observability/audit';

export default async function AdminAuditPage() {
  const entries = await recentAudit(getDb(), 200);
  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <PageHeader
        title="Immutable audit history"
        description="Newest server-recorded administrative actions. Database triggers reject row updates and deletes."
      />
      <div className="overflow-x-auto rounded-[var(--radius-lg)] border border-[var(--border)]">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-[var(--border)]">
              <th className="p-3">Time</th>
              <th className="p-3">Actor</th>
              <th className="p-3">Action</th>
              <th className="p-3">Target</th>
              <th className="p-3">Redacted diff</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr className="border-b border-[var(--border)] align-top" key={entry.id}>
                <td className="whitespace-nowrap p-3">{entry.createdAt.toISOString()}</td>
                <td className="p-3 font-mono text-xs">{entry.actorId}</td>
                <td className="p-3">{entry.action}</td>
                <td className="p-3">{entry.target}</td>
                <td className="max-w-md p-3">
                  <pre className="whitespace-pre-wrap text-xs">
                    {JSON.stringify(entry.diff, null, 2)}
                  </pre>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
