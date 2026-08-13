/** Rendered with HTTP 401 by `unauthorized()`. */
import Link from 'next/link';

export default function Unauthorized() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-3 px-6">
      <h1 className="text-2xl font-semibold">401 — Sign in required</h1>
      <Link className="text-[var(--accent)] underline" href="/sign-in">
        Go to sign in
      </Link>
    </main>
  );
}
