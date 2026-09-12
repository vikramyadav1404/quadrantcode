'use client';

/**
 * The sign-in choices: GitHub, then email or phone.
 *
 * ## Every option here is one the server can actually honour
 *
 * `github` and `phone` are both props, decided on the server. The GitHub option
 * stays visible so users know it is supported, but remains disabled until both
 * OAuth credentials exist. A Phone tab with `FEATURE_PHONE_OTP` off stays
 * hidden because its endpoint is feature-gated.
 *
 * This avoids a GitHub button that redirects to a broken OAuth screen while
 * keeping the available sign-in methods explicit.
 *
 * ## Tabs, not two forms on one page
 *
 * Two live forms means two submit buttons and an ambiguous Enter key. The tabs
 * follow the ARIA pattern — `role="tablist"`, arrow keys, one tab stop for the
 * set — so the traversal cost is one stop, not two forms' worth.
 */
import { useRef, useState } from 'react';
import { LoginForm } from './LoginForm';
import { PhoneLoginForm } from './PhoneLoginForm';
import { signInWithGitHubAction } from './actions';

type Method = 'email' | 'phone';

const METHODS: { id: Method; label: string }[] = [
  { id: 'email', label: 'Email' },
  { id: 'phone', label: 'Phone' },
];

export function LoginPanel({
  returnTo,
  github,
  email,
  phone,
}: {
  returnTo?: string;
  /** GITHUB_ID and GITHUB_SECRET are both set. */
  github: boolean;
  /** RESEND_API_KEY and EMAIL_FROM are both set. */
  email: boolean;
  /** FEATURE_PHONE_OTP is on. */
  phone: boolean;
}) {
  const [method, setMethod] = useState<Method>(email ? 'email' : 'phone');
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);

  /** Arrow keys move between tabs; the tablist itself is one tab stop. */
  function onTabKeyDown(event: React.KeyboardEvent, index: number) {
    const delta = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (delta === 0) return;

    event.preventDefault();
    const next = (index + delta + METHODS.length) % METHODS.length;
    setMethod(METHODS[next]!.id);
    tabs.current[next]?.focus();
  }

  return (
    <div className="relative flex flex-col gap-5">
      <>
        <form action={() => signInWithGitHubAction(returnTo)}>
          <button
            aria-describedby={github ? undefined : 'github-signin-unavailable'}
            className="auth-oauth-button"
            disabled={!github}
            type="submit"
          >
            {/*
                Inline mark, not an icon font or a remote image: this page is the
                first thing an unauthenticated visitor loads, and it should not
                depend on a third-party asset to render its primary control.
              */}
            <svg aria-hidden="true" height="18" viewBox="0 0 16 16" width="18">
              <path
                d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z"
                fill="currentColor"
              />
            </svg>
            Continue with GitHub
          </button>
        </form>

        {!github ? (
          <p className="auth-provider-note" id="github-signin-unavailable">
            GitHub sign-in will activate after OAuth is configured.
          </p>
        ) : null}

        <div
          className={`${github ? 'mt-5' : 'mt-8'} flex items-center gap-5 text-[0.7rem] text-[var(--text-muted)] uppercase`}
        >
          <span className="h-px flex-1 bg-[var(--border)]" />
          Or
          <span className="h-px flex-1 bg-[var(--border)]" />
        </div>
      </>

      {phone ? (
        <div aria-label="Sign-in method" className="auth-tablist" role="tablist">
          {METHODS.map((entry, index) => (
            <button
              aria-controls="signin-method-panel"
              aria-selected={method === entry.id}
              className="auth-tab"
              data-active={method === entry.id}
              id={`tab-${entry.id}`}
              key={entry.id}
              onClick={() => setMethod(entry.id)}
              onKeyDown={(event) => onTabKeyDown(event, index)}
              ref={(node) => {
                tabs.current[index] = node;
              }}
              role="tab"
              /* Roving tabindex: the SET is one stop, arrows move within it. */
              tabIndex={method === entry.id ? 0 : -1}
              type="button"
            >
              {entry.label}
            </button>
          ))}
        </div>
      ) : null}

      <div
        aria-labelledby={phone ? `tab-${method}` : undefined}
        id="signin-method-panel"
        role={phone ? 'tabpanel' : undefined}
      >
        {method === 'email' || !phone ? (
          email ? (
            <LoginForm returnTo={returnTo} />
          ) : (
            <div
              className="auth-provider-note rounded-lg border border-[var(--border)] p-4"
              role="status"
            >
              Email sign-in is not configured. Use an available provider or contact support.
            </div>
          )
        ) : (
          <PhoneLoginForm returnTo={returnTo} />
        )}
      </div>
    </div>
  );
}
