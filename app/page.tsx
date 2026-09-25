/**
 * The public landing page (F4.7b).
 *
 * ## Every claim here is true today
 *
 * F4.7's honesty rule, and the owner's: no invented numbers, no user counts,
 * no testimonials, and no feature that is not live. Concretely:
 *
 * - The screenshots are the real app, captured from a running build, signed in
 *   as a SEEDED DEMO account — so every number in them is example data, and
 *   each one says so beside it. They show only features that are not behind a
 *   flag, because a flag's production state is not something this page can
 *   know: revision modes, code execution and original problems are absent.
 * - Nothing about contests, referrals, coins, AI or pricing appears: those
 *   tickets are cut (D17, D34), and there is no paid plan to price.
 * - Each FAQ answer points at behaviour that exists in the code today.
 *
 * The mock "session intelligence" card that stood here showed invented figures
 * (a 24:18 timer, a "Live" pill). It was replaced by a real screenshot.
 */
import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { QuadrantMark } from '@/components/brand/QuadrantMark';
import { ThemeToggle } from '@/components/shell/ThemeToggle';
import { getPublicEnv } from '@/lib/env';

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

/** Real screens from the app, signed in as the seeded demo account. */
const SCREENS = [
  {
    src: '/screenshots/revision.png',
    title: 'A revision queue with its reasons',
    body: 'What is due today, hardest first — and every item says why it is there.',
    alt: 'The Revision page listing four problems due, each with the reasons it ranks where it does and Got it, Struggled and Lost it buttons.',
  },
  {
    src: '/screenshots/mistakes.png',
    title: 'Mistakes that repeat, grouped',
    body: 'Built from your own reflections and the stuck points you confirmed.',
    alt: 'The Mistakes page grouping recurring mistakes by topic, such as off by one in binary search, with counts and dates.',
  },
  {
    src: '/screenshots/analytics.png',
    title: 'Where your time goes',
    body: 'Streaks, time per solve, and the topics worth attention next, with the reasons.',
    alt: 'The Analytics page showing streak, solves this week, average session time, topics worth attention and minutes per solve.',
  },
] as const;

/** Each answer describes behaviour that exists in the code today. */
const FAQ = [
  {
    q: 'Where do the problems come from?',
    // True whether or not original problems are switched on in production.
    a: 'A problem from another platform links out to the site that hosts it; Quadrantcode never copies its text. What Quadrantcode records is how you solved it — time, stuck points, reflections and revision.',
  },
  {
    q: 'Who can see my practice?',
    a: 'Only you. A public profile is off until you turn it on, shows only the sections you choose, and never includes your code, notes, mistakes or reflections.',
  },
  {
    q: 'Can I delete my history?',
    a: 'Yes. Settings has a control that deletes your solve history, and you can stop code snapshots being captured at all.',
  },
  {
    q: 'Is there a paid plan?',
    a: 'No. There is nothing to buy today.',
  },
  {
    q: 'Are the company tags real interview questions?',
    a: 'No. Company names describe a style of practice. Quadrantcode is independent and does not present any problem as an official or previously asked question.',
  },
] as const;

/**
 * Structured data for search engines — facts only. No `aggregateRating`, no
 * `offers` and no user counts: there are no reviews or prices to state.
 */
function jsonLd(origin: string): string {
  return JSON.stringify({
    '@context': 'https://schema.org',
    '@graph': [
      { '@type': 'WebSite', name: 'Quadrantcode', url: origin },
      {
        '@type': 'WebApplication',
        name: 'Quadrantcode',
        url: origin,
        applicationCategory: 'EducationalApplication',
        operatingSystem: 'Web',
        description:
          'Tracks coding practice — solve time, stuck points, reflections and mistakes — and builds a revision queue from it.',
      },
    ],
  }).replace(/</g, '\\u003c');
}

export default function HomePage() {
  const origin = getPublicEnv().NEXT_PUBLIC_APP_URL;
  return (
    <div className="auth-shell min-h-dvh">
      <script
        // A static object built above; `<` is escaped so it cannot close the tag.
        dangerouslySetInnerHTML={{ __html: jsonLd(origin) }}
        type="application/ld+json"
      />
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
          <a className="transition-colors hover:text-[var(--text-primary)]" href="#screens">
            The app
          </a>
          <a className="transition-colors hover:text-[var(--text-primary)]" href="#faq">
            Questions
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
            <figure className="auth-card relative overflow-hidden rounded-3xl p-2 sm:p-3">
              <Image
                alt="The Quadrantcode dashboard: current streak, solves this week and in total, average session time, a year of activity, and the topics worth attention next."
                className="h-auto w-full rounded-2xl"
                height={900}
                priority
                sizes="(min-width: 1024px) 34rem, 100vw"
                src="/screenshots/dashboard.png"
                width={1440}
              />
              <figcaption className="px-2 pt-2 pb-1 text-xs text-[var(--text-muted)]">
                The real dashboard, signed in as a demo account — the numbers are example data.
              </figcaption>
            </figure>
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
          aria-labelledby="screens-heading"
          className="mx-auto w-full max-w-7xl px-5 py-20 sm:px-8 lg:px-12 lg:py-24"
          id="screens"
        >
          <div className="max-w-2xl">
            <p className="text-xs font-bold tracking-[0.16em] text-[var(--accent)] uppercase">
              The real app
            </p>
            <h2
              className="mt-3 text-3xl font-semibold tracking-[-0.04em] sm:text-4xl"
              id="screens-heading"
            >
              What you see once you have practised a little.
            </h2>
            <p className="mt-3 text-sm leading-6 text-[var(--text-muted)]">
              Screenshots of the running app, signed in as a demo account. Every number in them
              is example data, not anybody&apos;s real practice.
            </p>
          </div>

          <ul className="mt-12 grid gap-6 lg:grid-cols-3">
            {SCREENS.map((screen) => (
              <li key={screen.src}>
                <figure className="flex h-full flex-col rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-2">
                  <Image
                    alt={screen.alt}
                    className="h-auto w-full rounded-xl"
                    height={900}
                    loading="lazy"
                    sizes="(min-width: 1024px) 33vw, 100vw"
                    src={screen.src}
                    width={1440}
                  />
                  <figcaption className="px-2 pt-3 pb-2">
                    <span className="block text-sm font-semibold">{screen.title}</span>
                    <span className="mt-1 block text-sm leading-6 text-[var(--text-muted)]">
                      {screen.body}
                    </span>
                    <span className="mt-2 block text-xs text-[var(--text-muted)]">
                      Demo account · example data
                    </span>
                  </figcaption>
                </figure>
              </li>
            ))}
          </ul>
        </section>

        <section
          aria-labelledby="faq-heading"
          className="border-y border-[var(--border)] bg-[var(--surface)]/70"
          id="faq"
        >
          <div className="mx-auto w-full max-w-3xl px-5 py-20 sm:px-8 lg:py-24">
            <h2
              className="text-3xl font-semibold tracking-[-0.04em] sm:text-4xl"
              id="faq-heading"
            >
              Questions
            </h2>
            <dl className="mt-10 flex flex-col gap-8">
              {FAQ.map((item) => (
                <div key={item.q}>
                  <dt className="text-base font-semibold">{item.q}</dt>
                  <dd className="mt-2 text-sm leading-7 text-[var(--text-muted)]">{item.a}</dd>
                </div>
              ))}
            </dl>
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
        {/* The same wording the product shows beside company tags. */}
        <p className="mx-auto mb-4 w-full max-w-7xl text-xs leading-5 text-[var(--text-muted)] lg:px-4">
          Quadrantcode is independent and is not affiliated with or endorsed by any listed
          company or by the platforms it links to. Company names are used descriptively.
          Pattern-based practice is not presented as an official or previously asked question.
        </p>
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
