/** Phone verification settings page. */
import { PhoneVerificationForm } from '@/components/auth/PhoneVerificationForm';
import { requireCurrentUser } from '@/server/services/auth/session';

export default async function PhoneSettingsPage() {
  const user = await requireCurrentUser();

  return (
    <main className="mx-auto max-w-md px-6 py-10">
      <h1 className="text-2xl font-semibold">Verify your phone</h1>
      <p className="mt-1 mb-6 text-sm text-[var(--text-muted)]">
        Phone verification unlocks reminders and raises your daily reward cap.
      </p>
      <PhoneVerificationForm initialLevel={user.verificationLevel} />
    </main>
  );
}
