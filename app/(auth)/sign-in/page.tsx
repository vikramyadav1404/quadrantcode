/**
 * Minimal functional sign-in (F0.3 keeps UI out of scope beyond this).
 * F0.4 restyles it against the design system.
 */
import { signIn } from '@/server/services/auth/config';

export default function SignInPage() {
  async function sendMagicLink(formData: FormData) {
    'use server';
    const email = String(formData.get('email') ?? '')
      .trim()
      .toLowerCase();
    // Auth.js handles delivery, token creation and the generic response.
    await signIn('resend', { email, redirectTo: '/dashboard' });
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-6 px-6">
      <div>
        <h1 className="text-2xl font-semibold">Sign in to TraceLoop</h1>
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          We&apos;ll email you a link. No password to remember.
        </p>
      </div>

      <form action={sendMagicLink} className="flex flex-col gap-3">
        <label className="text-sm" htmlFor="email">
          Email address
        </label>
        <input
          className="rounded border border-[var(--border)] bg-[var(--surface)] px-3 py-2"
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
        />
        <button
          className="rounded bg-[var(--accent)] px-3 py-2 font-medium text-[var(--accent-foreground)]"
          type="submit"
        >
          Send sign-in link
        </button>
      </form>
    </main>
  );
}
