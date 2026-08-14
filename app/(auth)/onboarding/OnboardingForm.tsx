'use client';

/**
 * Onboarding: display name, timezone, target role.
 *
 * The timezone is pre-filled from `Intl.DateTimeFormat().resolvedOptions()`,
 * which only exists in the browser — so it is set in an effect rather than
 * rendered server-side, where it would resolve to the SERVER's zone and be
 * wrong for most users. It stays editable: a traveller or a VPN user should be
 * able to correct it.
 */
import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { TARGET_ROLES, TARGET_ROLE_LABELS, updateProfileSchema } from '@/lib/profile/schemas';
import { completeOnboardingAction } from './actions';

export function OnboardingForm({
  defaultTimezone,
  suggestedName,
  returnTo,
}: {
  defaultTimezone: string;
  suggestedName: string;
  returnTo?: string;
}) {
  const router = useRouter();
  const [displayName, setDisplayName] = useState(suggestedName);
  const [timezone, setTimezone] = useState(defaultTimezone);
  const [targetRole, setTargetRole] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    // Browser-resolved, because the server's zone is not the user's.
    try {
      const resolved = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (resolved) setTimezone(resolved);
    } catch {
      // Keep the server default if the browser will not tell us.
    }
  }, []);

  function submit() {
    setErrors({});

    const payload = {
      displayName,
      timezone,
      targetRole: targetRole || undefined,
      publicProfileEnabled: false,
    };

    const parsed = updateProfileSchema.safeParse(payload);
    if (!parsed.success) {
      const next: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = String(issue.path[0] ?? 'form');
        next[key] ??= issue.message;
      }
      setErrors(next);
      return;
    }

    startTransition(async () => {
      const result = await completeOnboardingAction({ ...payload, returnTo });
      if (result.ok) {
        router.replace(result.next);
        router.refresh();
      } else {
        setErrors({ form: result.message });
      }
    });
  }

  const field =
    'w-full rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm';

  return (
    <div className="flex flex-col gap-4">
      <div>
        <label className="mb-1 block text-sm" htmlFor="displayName">
          What should we call you?
        </label>
        <input
          aria-describedby={errors.displayName ? 'displayName-error' : undefined}
          aria-invalid={Boolean(errors.displayName)}
          autoFocus
          className={field}
          id="displayName"
          maxLength={40}
          onChange={(event) => setDisplayName(event.target.value)}
          value={displayName}
        />
        {errors.displayName ? (
          <p className="mt-1 text-sm text-[var(--danger)]" id="displayName-error">
            {errors.displayName}
          </p>
        ) : null}
      </div>

      <div>
        <label className="mb-1 block text-sm" htmlFor="timezone">
          Timezone
        </label>
        <input
          aria-describedby="timezone-help"
          className={field}
          id="timezone"
          onChange={(event) => setTimezone(event.target.value)}
          value={timezone}
        />
        <p className="mt-1 text-xs text-[var(--text-muted)]" id="timezone-help">
          Your streak day starts and ends here, so this one matters.
        </p>
        {errors.timezone ? (
          <p className="mt-1 text-sm text-[var(--danger)]">{errors.timezone}</p>
        ) : null}
      </div>

      <div>
        <label className="mb-1 block text-sm" htmlFor="targetRole">
          Preparing for
        </label>
        <select
          className={field}
          id="targetRole"
          onChange={(event) => setTargetRole(event.target.value)}
          value={targetRole}
        >
          <option value="">Not sure yet</option>
          {TARGET_ROLES.map((role) => (
            <option key={role} value={role}>
              {TARGET_ROLE_LABELS[role]}
            </option>
          ))}
        </select>
      </div>

      {errors.form ? (
        <p className="text-sm text-[var(--danger)]" role="status">
          {errors.form}
        </p>
      ) : null}

      <button
        className="self-start rounded-[var(--radius)] bg-[var(--accent)] px-3 py-2 text-sm font-medium text-[var(--accent-foreground)] disabled:opacity-60"
        disabled={pending}
        onClick={submit}
        type="button"
      >
        {pending ? 'Setting up…' : 'Start tracking'}
      </button>
    </div>
  );
}
