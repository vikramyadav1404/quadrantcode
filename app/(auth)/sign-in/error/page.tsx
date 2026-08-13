export default function SignInErrorPage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-3 px-6">
      <h1 className="text-2xl font-semibold">That link didn&apos;t work</h1>
      <p className="text-[var(--text-muted)]">
        Sign-in links are single-use and expire after 15 minutes. Request a new one.
      </p>
      <a className="text-[var(--accent)] underline" href="/sign-in">
        Back to sign in
      </a>
    </main>
  );
}
