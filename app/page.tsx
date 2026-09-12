import type { Metadata } from 'next';
import Link from 'next/link';
import { QuadrantMark } from '@/components/brand/QuadrantMark';
import { ThemeToggle } from '@/components/shell/ThemeToggle';

export const metadata: Metadata = {
  title: 'Quadrantcode · Practice with intent',
  description:
    'Turn coding sessions, stuck points, mistakes, and revision into a practice system that compounds.',
};

const FEATURES = [
  {
    number: '01',
    title: 'See the whole attempt',
    body: 'Track active solving time, pauses, and the exact places where momentum breaks.',
  },
  {
    number: '02',
    title: 'Learn from friction',
    body: 'Reflect while the context is fresh and turn recurring mistakes into visible patterns.',
  },
  {
    number: '03',
    title: 'Return at the right time',
    body: 'Build a focused revision queue from what your own practice is telling you.',
  },
] as const;

const SIGNALS = [
  { label: 'Solve session', value: 'In focus', tone: 'text-[var(--accent)]' },
  { label: 'Stuck point', value: 'Captured', tone: 'text-[var(--warning)]' },
  { label: 'Reflection', value: 'Ready', tone: 'text-[var(--success)]' },
] as const;

export default function HomePage() {
  return (
    <div className="auth-shell min-h-dvh">
      <a
        className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:m-3 focus:rounded-lg focus:bg-[var(--surface-raised)] focus:px-4 focus:py-2"
        href="#main"
      >
        Skip to main content
      </a>

      <header className="relative z-10 mx-auto flex w-full max-w-7xl items-center justify-between px-5 py-5 sm:px-8 lg:px-12">
        <Link className="flex items-center gap-3" href="/">
          <QuadrantMark />
          <span className="text-base font-semibold tracking-[-0.02em]">Quadrantcode</span>
        </Link>

        <nav
          aria-label="Public"
          className="hidden items-center gap-7 text-sm text-[var(--text-muted)] md:flex"
        >
          <a
            className="transition-colors hover:text-[var(--text-primary)]"
            href="#how-it-works"
          >
            How it works
          </a>
          <a className="transition-colors hover:text-[var(--text-primary)]" href="#built-for">
            Why Quadrantcode
          </a>
        </nav>

        <div className="flex items-center gap-2 sm:gap-3">
          <ThemeToggle />
          <Link
            className="hidden min-h-10 items-center rounded-full border border-[var(--border)] bg-[var(--surface)] px-4 text-sm font-semibold transition-colors hover:bg-[var(--surface-raised)] sm:inline-flex"
            href="/login"
          >
            Sign in
          </Link>
        </div>
      </header>

      <main className="relative z-10" id="main">
        <section className="mx-auto grid w-full max-w-7xl items-center gap-14 px-5 pt-16 pb-24 sm:px-8 sm:pt-24 lg:grid-cols-[minmax(0,1fr)_minmax(28rem,0.92fr)] lg:px-12 lg:pt-28 lg:pb-32">
          <div>
            <div className="auth-eyebrow mb-6">
              <span className="auth-status-dot" />
              Practice that compounds
            </div>
            <h1 className="max-w-3xl text-5xl leading-[0.98] font-semibold tracking-[-0.055em] sm:text-6xl lg:text-7xl">
              Make every coding session count.
            </h1>
            <p className="mt-7 max-w-2xl text-lg leading-8 text-[var(--text-muted)] sm:text-xl">
              Quadrantcode connects solving, reflection, mistakes, and revision—so you improve
              from how you practice, not only from how many problems you finish.
            </p>

            <div className="mt-9 flex flex-col gap-3 sm:flex-row">
              <Link className="auth-primary-button sm:w-auto sm:px-6" href="/login">
                Start practicing
                <svg aria-hidden="true" fill="none" height="17" viewBox="0 0 16 16" width="17">
                  <path
                    d="M3 8h9M9 4.5 12.5 8 9 11.5"
                    stroke="currentColor"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="1.5"
                  />
                </svg>
              </Link>
              <a className="auth-secondary-button sm:w-auto sm:px-6" href="#how-it-works">
                See the practice loop
              </a>
            </div>
            <p className="mt-4 text-xs leading-5 text-[var(--text-muted)]">
              Passwordless access · Private by default · Built for deliberate practice
            </p>
          </div>

          <div className="relative mx-auto w-full max-w-[34rem] lg:mx-0 lg:ml-auto">
            <div
              aria-hidden="true"
              className="absolute -inset-8 rounded-full bg-[var(--accent)] opacity-[0.06] blur-3xl"
            />
            <div className="auth-card relative overflow-hidden rounded-3xl p-5 sm:p-7">
              <div className="flex items-start justify-between gap-4 border-b border-[var(--border)] pb-5">
                <div>
                  <p className="text-[0.68rem] font-bold tracking-[0.15em] text-[var(--text-muted)] uppercase">
                    Session intelligence
                  </p>
                  <h2 className="mt-2 text-xl font-semibold tracking-[-0.025em]">
                    Binary Search Patterns
                  </h2>
                </div>
                <span className="auth-live-pill">
                  <span className="auth-status-dot" /> Live
                </span>
              </div>

              <div className="grid grid-cols-2 gap-3 py-5">
                <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
                  <p className="text-xs text-[var(--text-muted)]">Active time</p>
                  <p className="mt-2 text-2xl font-semibold tabular-nums">24:18</p>
                </div>
                <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
                  <p className="text-xs text-[var(--text-muted)]">Current phase</p>
                  <p className="mt-2 text-base font-semibold text-[var(--accent)]">Refining</p>
                </div>
              </div>

              <div className="rounded-2xl bg-[var(--surface)] p-4">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <p className="text-sm font-semibold">Practice signals</p>
                  <p className="text-xs text-[var(--text-muted)]">Today</p>
                </div>
                <ul className="grid gap-3">
                  {SIGNALS.map((signal) => (
                    <li
                      className="flex items-center justify-between gap-3 text-sm"
                      key={signal.label}
                    >
                      <span className="flex items-center gap-2 text-[var(--text-muted)]">
                        <span
                          aria-hidden="true"
                          className="h-1.5 w-1.5 rounded-full bg-[var(--border)]"
                        />
                        {signal.label}
                      </span>
                      <span className={`font-semibold ${signal.tone}`}>{signal.value}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="mt-5 flex items-center gap-3 rounded-xl border border-[var(--border)] p-4">
                <span className="auth-step-number">↻</span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold">Next revision is ready</span>
                  <span className="mt-0.5 block text-xs text-[var(--text-muted)]">
                    Revisit the boundary-condition mistake while it is still useful.
                  </span>
                </span>
              </div>
            </div>
          </div>
        </section>

        <section
          className="border-y border-[var(--border)] bg-[var(--surface)]/70"
          id="how-it-works"
        >
          <div className="mx-auto w-full max-w-7xl px-5 py-20 sm:px-8 lg:px-12 lg:py-24">
            <div className="max-w-2xl">
              <p className="text-xs font-bold tracking-[0.16em] text-[var(--accent)] uppercase">
                One connected loop
              </p>
              <h2 className="mt-3 text-3xl font-semibold tracking-[-0.04em] sm:text-4xl">
                Progress becomes clearer when the context stays connected.
              </h2>
            </div>

            <ol className="mt-12 grid gap-4 lg:grid-cols-3">
              {FEATURES.map((feature) => (
                <li
                  className="rounded-2xl border border-[var(--border)] bg-[var(--surface-raised)] p-6"
                  key={feature.number}
                >
                  <span className="auth-step-number">{feature.number}</span>
                  <h3 className="mt-7 text-lg font-semibold">{feature.title}</h3>
                  <p className="mt-2 text-sm leading-6 text-[var(--text-muted)]">
                    {feature.body}
                  </p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section
          className="mx-auto w-full max-w-7xl px-5 py-20 sm:px-8 lg:px-12 lg:py-28"
          id="built-for"
        >
          <div className="auth-card grid items-center gap-10 rounded-3xl p-7 sm:p-10 lg:grid-cols-[1fr_auto] lg:p-12">
            <div className="max-w-3xl">
              <p className="text-xs font-bold tracking-[0.16em] text-[var(--accent)] uppercase">
                Built for deliberate practice
              </p>
              <h2 className="mt-3 text-3xl font-semibold tracking-[-0.04em] sm:text-4xl">
                Stop collecting solved problems. Start building reusable skill.
              </h2>
              <p className="mt-4 max-w-2xl text-sm leading-7 text-[var(--text-muted)] sm:text-base">
                Keep the evidence from each attempt, spot the patterns across sessions, and give
                your next study block a clear starting point.
              </p>
            </div>
            <Link className="auth-primary-button lg:w-auto lg:px-7" href="/login">
              Open your workspace
              <svg aria-hidden="true" fill="none" height="17" viewBox="0 0 16 16" width="17">
                <path
                  d="M3 8h9M9 4.5 12.5 8 9 11.5"
                  stroke="currentColor"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="1.5"
                />
              </svg>
            </Link>
          </div>
        </section>
      </main>

      <footer className="relative z-10 border-t border-[var(--border)] px-5 py-8 sm:px-8">
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 text-xs text-[var(--text-muted)] sm:flex-row sm:items-center sm:justify-between lg:px-4">
          <p>© 2026 Quadrantcode. Built for focused practice.</p>
          <nav aria-label="Legal" className="flex flex-wrap gap-x-5 gap-y-2">
            <Link href="/privacy">Privacy</Link>
            <Link href="/terms">Terms</Link>
            <Link href="/security">Security</Link>
            <Link href="/contact">Contact</Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
