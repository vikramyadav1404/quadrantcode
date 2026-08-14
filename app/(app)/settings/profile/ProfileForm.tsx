'use client';

/**
 * Profile form with an OPTIMISTIC save.
 *
 * The displayed state updates immediately and is rolled back if the server
 * rejects or the request fails — including a timeout, which is the case the
 * F0.5 criterion names ("rolls back correctly on timeout"). The rollback
 * restores the last state the SERVER confirmed, not the previous render, so
 * two failed saves in a row cannot leave a half-applied value on screen.
 */
import { useRef, useState, useTransition } from 'react';
import { AvatarUploader } from '@/components/avatar/AvatarUploader';
import type { AvatarAppearanceProps } from '@/components/avatar/Avatar';
import { useToast } from '@/components/ui/Toast';
import {
  PUBLIC_PROFILE_DISCLOSURE,
  TARGET_ROLES,
  TARGET_ROLE_LABELS,
  updateProfileSchema,
} from '@/lib/profile/schemas';
import { saveProfileAction } from './actions';

export type ProfileFormValues = {
  displayName: string;
  bio: string;
  targetRole: string | null;
  timezone: string;
  publicProfileEnabled: boolean;
  avatarUrl: string | null;
};

/** Abort a save that hangs, so the optimistic state cannot stick forever. */
const SAVE_TIMEOUT_MS = 10_000;

export function ProfileForm({
  initial,
  appearance,
}: {
  initial: ProfileFormValues;
  appearance: AvatarAppearanceProps;
}) {
  const [values, setValues] = useState(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();
  const { push } = useToast();

  /** The last state the SERVER accepted — the rollback target. */
  const committed = useRef(initial);

  function set<K extends keyof ProfileFormValues>(key: K, value: ProfileFormValues[K]) {
    setValues((current) => ({ ...current, [key]: value }));
  }

  function save() {
    setErrors({});

    const payload = {
      displayName: values.displayName,
      bio: values.bio || undefined,
      targetRole: values.targetRole ?? undefined,
      timezone: values.timezone,
      publicProfileEnabled: values.publicProfileEnabled,
    };

    // Consumer #1 of the shared schema; the action re-parses server-side.
    const parsed = updateProfileSchema.safeParse(payload);
    if (!parsed.success) {
      const fieldErrors: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = String(issue.path[0] ?? 'form');
        fieldErrors[key] ??= issue.message;
      }
      setErrors(fieldErrors);
      return;
    }

    const optimistic = { ...values };
    const rollback = committed.current;

    startTransition(async () => {
      const timeout = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('timeout')), SAVE_TIMEOUT_MS),
      );

      try {
        const result = await Promise.race([saveProfileAction(payload), timeout]);

        if (result.ok) {
          committed.current = optimistic;
          push('Profile saved.', 'success');
        } else {
          setValues(rollback);
          push(result.message, 'danger');
        }
      } catch {
        // Timeout or transport failure — restore the last confirmed state.
        setValues(rollback);
        push('Could not save. Your changes were reverted.', 'danger');
      }
    });
  }

  const field =
    'w-full rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm';

  return (
    <div className="max-w-xl">
      <section className="mb-8">
        <h2 className="mb-3 text-lg font-semibold">Photo</h2>
        <AvatarUploader
          appearance={appearance}
          initialUrl={values.avatarUrl}
          onChange={(url) => {
            set('avatarUrl', url);
            committed.current = { ...committed.current, avatarUrl: url };
          }}
        />
      </section>

      <section className="flex flex-col gap-4">
        <div>
          <label className="mb-1 block text-sm" htmlFor="displayName">
            Display name
          </label>
          <input
            aria-describedby={errors.displayName ? 'displayName-error' : undefined}
            aria-invalid={Boolean(errors.displayName)}
            className={field}
            id="displayName"
            maxLength={40}
            onChange={(event) => set('displayName', event.target.value)}
            value={values.displayName}
          />
          {errors.displayName ? (
            <p className="mt-1 text-sm text-[var(--danger)]" id="displayName-error">
              {errors.displayName}
            </p>
          ) : null}
        </div>

        <div>
          <label className="mb-1 block text-sm" htmlFor="bio">
            Bio
          </label>
          <textarea
            className={field}
            id="bio"
            maxLength={280}
            onChange={(event) => set('bio', event.target.value)}
            rows={3}
            value={values.bio}
          />
          <p className="mt-1 text-xs text-[var(--text-muted)]">
            {values.bio.length}/280 · plain text, no formatting or links
          </p>
        </div>

        <div>
          <label className="mb-1 block text-sm" htmlFor="targetRole">
            Preparing for
          </label>
          <select
            className={field}
            id="targetRole"
            onChange={(event) => set('targetRole', event.target.value || null)}
            value={values.targetRole ?? ''}
          >
            <option value="">Not saying yet</option>
            {TARGET_ROLES.map((role) => (
              <option key={role} value={role}>
                {TARGET_ROLE_LABELS[role]}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="mb-1 block text-sm" htmlFor="timezone">
            Timezone
          </label>
          <input
            aria-describedby={errors.timezone ? 'timezone-error' : 'timezone-help'}
            aria-invalid={Boolean(errors.timezone)}
            className={field}
            id="timezone"
            onChange={(event) => set('timezone', event.target.value)}
            value={values.timezone}
          />
          <p className="mt-1 text-xs text-[var(--text-muted)]" id="timezone-help">
            Your streak day starts and ends in this zone.
          </p>
          {errors.timezone ? (
            <p className="mt-1 text-sm text-[var(--danger)]" id="timezone-error">
              {errors.timezone}
            </p>
          ) : null}
        </div>

        <div className="rounded-[var(--radius)] border border-[var(--border)] p-3">
          <label className="flex items-start gap-3 text-sm">
            <input
              checked={values.publicProfileEnabled}
              className="mt-1"
              onChange={(event) => set('publicProfileEnabled', event.target.checked)}
              type="checkbox"
            />
            <span>
              <span className="font-medium">Public profile</span>
              <span className="mt-1 block text-xs text-[var(--text-muted)]">
                {PUBLIC_PROFILE_DISCLOSURE}
              </span>
            </span>
          </label>
        </div>

        <button
          className="self-start rounded-[var(--radius)] bg-[var(--accent)] px-3 py-2 text-sm font-medium text-[var(--accent-foreground)] disabled:opacity-60"
          disabled={pending}
          onClick={save}
          type="button"
        >
          {pending ? 'Saving…' : 'Save profile'}
        </button>
      </section>
    </div>
  );
}
