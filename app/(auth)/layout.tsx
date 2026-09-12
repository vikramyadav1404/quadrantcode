import { QuadrantMark } from '@/components/brand/QuadrantMark';
import Link from 'next/link';

const SESSION_ROWS = [
  ['Problem', 'Merge Intervals'],
  ['Time', '31m 42s'],
  ['Friction', 'Edge-case handling'],
  ['Review', 'Tomorrow'],
] as const;

/**
 * A deliberate split-screen entry point: editorial product context on the
 * left, focused account access on the right. On smaller screens the story
 * panel steps away and the form gets the whole viewport.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="auth-reference-shell min-h-dvh">
      <a
        className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:m-3 focus:bg-[var(--surface-raised)] focus:px-4 focus:py-2"
        href="#main"
      >
        Skip to main content
      </a>

      <main className="grid min-h-dvh lg:grid-cols-[54%_46%]" id="main">
        <section
          className="auth-story-panel hidden min-h-dvh flex-col lg:flex"
          aria-labelledby="auth-story-title"
        >
          <div className="auth-story-brand">
            <QuadrantMark />
            <span>Quadrantcode</span>
          </div>

          <div className="auth-story-content">
            <p className="auth-story-kicker">Quadrant&nbsp; / &nbsp;Practice intelligence</p>
            <h2 id="auth-story-title">Every solve leaves a signal.</h2>
            <p className="auth-story-copy">
              Quadrantcode turns practice sessions
              <br />
              into clear next steps.
            </p>

            <div className="auth-session-slip" aria-label="Example practice session insight">
              <div className="auth-session-heading">
                <strong>Session 042</strong>
                <span>Completed · 2 min ago</span>
              </div>
              <dl>
                {SESSION_ROWS.map(([label, value]) => (
                  <div className="auth-session-row" key={label}>
                    <dt>{label}</dt>
                    <dd>{value}</dd>
                  </div>
                ))}
              </dl>
              <p className="auth-session-next">Next: 3 targeted problems</p>
            </div>
          </div>
        </section>

        <section className="auth-access-panel" aria-label="Account access">
          <div className="auth-mobile-brand lg:hidden">
            <QuadrantMark />
            <span>Quadrantcode</span>
          </div>

          <div className="auth-access-content">
            <div className="auth-login-mark">
              <QuadrantMark />
            </div>
            <div className="w-full">{children}</div>

            <div className="auth-access-trust">
              <p>
                <svg aria-hidden="true" fill="none" height="17" viewBox="0 0 18 18" width="17">
                  <path
                    d="M9 1.8 15 4v4.3c0 3.6-2.4 6.5-6 7.9-3.6-1.4-6-4.3-6-7.9V4l6-2.2Z"
                    stroke="currentColor"
                    strokeLinejoin="round"
                    strokeWidth="1.4"
                  />
                  <path
                    d="M9 5.2v6.3M6.7 8.3H9"
                    stroke="currentColor"
                    strokeLinecap="round"
                    strokeWidth="1.3"
                  />
                </svg>
                <span>Passwordless</span>
                <span aria-hidden="true">•</span>
                <span>Your practice data stays private.</span>
              </p>
              <p className="auth-access-links" aria-label="Product policies">
                <Link href="/privacy">Privacy</Link>
                <span aria-hidden="true">•</span>
                <Link href="/terms">Terms</Link>
                <span aria-hidden="true">•</span>
                <Link href="/security">Security</Link>
              </p>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
