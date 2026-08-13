/**
 * Placeholder root route. F4.7 (`public-surface`) replaces this with the real
 * landing page; F0.4 adds the authenticated shell at app/(app)/layout.tsx.
 */
export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col justify-center gap-4 px-6">
      <h1 className="text-3xl font-semibold">TraceLoop</h1>
      <p className="text-[var(--text-muted)]">
        Don&apos;t just solve problems. Learn from where you got stuck.
      </p>
      <p className="text-sm text-[var(--text-muted)]">
        Phase 0 scaffold. Not affiliated with or endorsed by any company or coding platform.
      </p>
    </main>
  );
}
