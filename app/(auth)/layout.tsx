/**
 * Signed-out layout — deliberately distinct from the authenticated shell.
 *
 * No sidebar, no top bar, no avatar: none of it has data to show, and
 * rendering a logged-in chrome around a login form is how users end up unsure
 * whether they are signed in.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <a
        className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:m-2 focus:rounded focus:bg-[var(--surface-raised)] focus:px-3 focus:py-2"
        href="#main"
      >
        Skip to main content
      </a>

      <header className="px-6 py-5">
        <span className="font-semibold tracking-tight">TraceLoop</span>
      </header>

      <main className="flex flex-1 items-start justify-center px-6 pb-16" id="main">
        <div className="w-full max-w-sm">{children}</div>
      </main>

      <footer className="px-6 py-6 text-center text-xs text-[var(--text-muted)]">
        Not affiliated with or endorsed by any company or coding platform.
      </footer>
    </div>
  );
}
