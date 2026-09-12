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

  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <div>
        <label className="auth-label" htmlFor="displayName">
          What should we call you?
        </label>
        <input
          aria-describedby={errors.displayName ? 'displayName-error' : undefined}
          aria-invalid={Boolean(errors.displayName)}
          className="auth-field"
          id="displayName"
          maxLength={40}
          onChange={(event) => setDisplayName(event.target.value)}
          placeholder="Your name"
          required
          value={displayName}
        />
        {errors.displayName ? (
          <p className="mt-1 text-sm text-[var(--danger)]" id="displayName-error">
            {errors.displayName}
          </p>
        ) : null}
      </div>

      <div>
        <label className="auth-label" htmlFor="timezone">
          Timezone
        </label>
        <input
          aria-describedby={errors.timezone ? 'timezone-help timezone-error' : 'timezone-help'}
          aria-invalid={Boolean(errors.timezone)}
          className="auth-field"
          id="timezone"
          onChange={(event) => setTimezone(event.target.value)}
          value={timezone}
        />
        <p className="mt-1 text-xs text-[var(--text-muted)]" id="timezone-help">
          Your streak day starts and ends here, so this one matters.
        </p>
        {errors.timezone ? (
          <p className="mt-1 text-sm text-[var(--danger)]" id="timezone-error">
            {errors.timezone}
          </p>
        ) : null}
      </div>

      <div>
        <label className="auth-label" htmlFor="targetRole">
          Preparing for
        </label>
        <select
          className="auth-field"
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

      <button className="auth-primary-button mt-1" disabled={pending} type="submit">
        {pending ? 'Setting up…' : 'Start tracking'}
        {!pending ? (
          <svg aria-hidden="true" fill="none" height="16" viewBox="0 0 16 16" width="16">
            <path
              d="M3 8h9M9 4.5 12.5 8 9 11.5"
              stroke="currentColor"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="1.5"
            />
          </svg>
        ) : null}
      </button>
    </form>
  );
}
