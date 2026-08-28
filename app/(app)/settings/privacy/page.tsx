/**
 * What TraceLoop records about how you solve, and how to stop it.
 *
 * ## The copy describes what happens, not what the policy says
 *
 * Snapshots are kept for ninety days by `npm run snapshots:purge`, and
 * **nothing schedules that** — F2.3 is cut (D17). So this page does not promise
 * automatic deletion after ninety days. It says what is true: ninety days is
 * the retention window, the cleanup runs on demand, and the delete button below
 * is the thing that erases immediately.
 *
 * Writing the intended policy instead would be the sort of privacy statement
 * that is technically aspirational and practically false.
 */
import { PageHeader } from '@/components/ui/PageHeader';
import { getDb } from '@/server/db';
import { requireCurrentUser } from '@/server/services/auth/session';
import { snapshotCaptureEnabled } from '@/server/services/profile';
import { SNAPSHOT_RETENTION_DAYS } from '@/lib/timeline/events';
import { PrivacyForm } from './PrivacyForm';
import { deleteHistoryAction, setCaptureAction } from './actions';

export default async function PrivacySettingsPage() {
  const user = await requireCurrentUser();
  const enabled = await snapshotCaptureEnabled(getDb(), user.id);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        description="What TraceLoop records while you solve, and how to erase it."
        title="Privacy"
      />

      <section className="text-sm">
        <h2 className="mb-2 font-medium">What is recorded</h2>
        <ul className="flex flex-col gap-1 text-[var(--text-muted)]">
          <li>
            · <strong>A timeline of events</strong> — when a session started, when you paused,
            when you ran your code, when you marked yourself stuck.
          </li>
          <li>
            · <strong>Snapshots of your code</strong> — taken when you run it, so you can see
            later how a solution took shape.
          </li>
          <li>· Nothing is shared with anyone. Nothing is used to train anything.</li>
        </ul>
      </section>

      <section className="text-sm">
        <h2 className="mb-2 font-medium">How long it is kept</h2>
        <p className="text-[var(--text-muted)]">
          Code snapshots are kept for {SNAPSHOT_RETENTION_DAYS} days.{' '}
          <strong>
            The cleanup is run manually rather than on a schedule, so snapshots may survive past
            that window until it is next run.
          </strong>{' '}
          The button below deletes yours immediately.
        </p>
        <p className="mt-1 text-[var(--text-muted)]">
          Timeline events are kept for as long as the session is — your streak, your analytics
          and your revision schedule are all built from them.
        </p>
      </section>

      <PrivacyForm
        enabled={enabled}
        onDelete={deleteHistoryAction}
        onToggle={setCaptureAction}
      />
    </div>
  );
}
