/** Rendered with HTTP 403 by `forbidden()`. */
export default function Forbidden() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-3 px-6">
      <h1 className="text-2xl font-semibold">403 — Not allowed</h1>
      <p className="text-[var(--text-muted)]">
        Your account does not have access to this area.
      </p>
    </main>
  );
}
