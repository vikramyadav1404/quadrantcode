/**
 * Phone verification settings page.
 *
 * ## It moved into `(app)` in F0.3b
 *
 * It used to live at `app/settings/phone/`, outside the route group. The URL
 * resolved, so nothing failed — but the page rendered with no sidebar, no
 * bottom nav and none of the shell's gates, while every other `/settings/*`
 * page had them. A user arriving from the settings index lost the navigation
 * they arrived with.
 *
 * It also carried its OWN `<main>`, which inside the group's layout would have
 * been a second `main` landmark nested in the first — a duplicate that a screen
 * reader has no way to make sense of. The wrapper is gone; `(app)/layout.tsx`
 * owns the landmark, as it does for every sibling page.
 */
import { PhoneVerificationForm } from '@/components/auth/PhoneVerificationForm';
import { isFeatureEnabled } from '@/lib/flags';
import { requireCurrentUser } from '@/server/services/auth/session';

export default async function PhoneSettingsPage() {
  const user = await requireCurrentUser();
  const signInEnabled = isFeatureEnabled('FEATURE_PHONE_OTP');

  return (
    <div className="flex max-w-md flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Verify your phone</h1>
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          Phone verification unlocks reminders and raises your daily reward cap.
          {signInEnabled ? ' A verified number can also sign you in.' : ''}
        </p>
      </div>

      <PhoneVerificationForm initialLevel={user.verificationLevel} />
    </div>
  );
}
