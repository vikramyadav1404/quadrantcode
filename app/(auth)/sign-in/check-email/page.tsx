export default function CheckEmailPage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-3 px-6">
      <h1 className="text-2xl font-semibold">Check your email</h1>
      <p className="text-[var(--text-muted)]">
        If that address has an account, a sign-in link is on its way. It expires in 15 minutes.
      </p>
    </main>
  );
}
