import { signOutAction } from '@/app/(auth)/login/actions';

/**
 * Sign out of this browser.
 *
 * A form posting a server action, so it works before hydration and without
 * client JavaScript. Rendered on /settings, which the sidebar links to, and on
 * /settings/profile, which the top-bar avatar links to — the avatar is the only
 * route into settings under 768px, where the sidebar is hidden and the bottom
 * nav has no Settings item.
 */
export function SignOutButton() {
  return (
    <section
      aria-labelledby="sign-out-heading"
      className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-3"
    >
      <h2 className="font-medium" id="sign-out-heading">
        Sign out
      </h2>
      <p className="mt-0.5 text-sm text-[var(--text-muted)]">
        Ends your session in this browser. Other devices stay signed in.
      </p>
      <form action={signOutAction} className="mt-3">
        <button
          className="rounded-[var(--radius)] border border-[var(--border)] px-3 py-1.5 text-sm font-medium hover:bg-[var(--surface-raised)]"
          type="submit"
        >
          Sign out
        </button>
      </form>
    </section>
  );
}
