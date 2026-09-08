'use client';

/**
 * Sign-in form: idle → sending → sent.
 *
 * On success the form is REPLACED by a check-your-email panel rather than
 * sitting underneath a success message — the next action is checking an inbox,
 * not editing the field again.
 *
 * The countdown is a display of the server's cooldown, never the control. If
 * the server says wait, the button stays disabled regardless of what the timer
 * shows; if the page is reloaded the server still refuses. See D13.
 */
import { useCallback, useEffect, useState } from 'react';
import { type SendLinkResult, sendMagicLinkAction } from './actions';

type Status = 'idle' | 'sending' | 'sent';

export function LoginForm({ returnTo }: { returnTo?: string }) {
  const [status, setStatus] = useState<Status>('idle');
  const [email, setEmail] = useState('');
  const [maskedEmail, setMaskedEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((seconds) => seconds - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  const send = useCallback(
    async (address: string) => {
      setError(null);
      setStatus((current) => (current === 'sent' ? 'sent' : 'sending'));

      const result: SendLinkResult = await sendMagicLinkAction({ email: address, returnTo });

      if (result.ok) {
        setMaskedEmail(result.maskedEmail);
        setCooldown(result.cooldownSeconds);
        setStatus('sent');
      } else {
        // The server decides the wait; the UI only reflects it.
        if (result.retryAfterSeconds) setCooldown(result.retryAfterSeconds);
        setError(result.message);
        setStatus((current) => (current === 'sent' ? 'sent' : 'idle'));
      }
    },
    [returnTo],
  );

  if (status === 'sent') {
    return (
      <section aria-live="polite">
        <div className="auth-success-mark mb-4">
          <svg aria-hidden="true" fill="none" height="23" viewBox="0 0 24 24" width="23">
            <path
              d="m6 12 4 4 8-9"
              stroke="currentColor"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
            />
          </svg>
        </div>
        <h2 className="text-xl font-semibold tracking-[-0.02em]">Check your email</h2>
        <p className="mt-2 text-sm leading-6 text-[var(--text-muted)]">
          If <strong className="text-[var(--text-primary)]">{maskedEmail}</strong> has an
          account, a sign-in link is on its way. It expires in 15 minutes.
        </p>
        {/*
         * `aria-disabled`, not `disabled`.
         *
         * A `disabled` button is removed from the tab order, so a keyboard user
         * mid-cooldown finds the control has simply vanished with no
         * explanation. Kept focusable, it is reachable and announced as
         * "Resend in 45s". The click is guarded below, and the SERVER enforces
         * the cooldown regardless — so a press during the window is answered,
         * not obeyed.
         */}
        <button
          aria-disabled={cooldown > 0}
          className="auth-secondary-button mt-6"
          onClick={() => {
            if (cooldown > 0) return;
            void send(email);
          }}
          type="button"
        >
          {cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend link'}
        </button>
        {error ? (
          <p className="mt-3 text-sm text-[var(--danger)]" role="status">
            {error}
          </p>
        ) : null}
        <button
          className="mx-auto mt-4 block text-sm font-medium text-[var(--text-muted)] underline decoration-[var(--border)] underline-offset-4 hover:text-[var(--text-primary)]"
          onClick={() => {
            setStatus('idle');
            setError(null);
          }}
          type="button"
        >
          Use a different address
        </button>
      </section>
    );
  }

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        void send(email);
      }}
    >
      <div>
        <label className="auth-label" htmlFor="email">
          Email address
        </label>
        <input
          aria-describedby={error ? 'email-error' : 'email-hint'}
          aria-invalid={Boolean(error)}
          autoComplete="email"
          className="auth-field"
          id="email"
          name="email"
          onChange={(event) => setEmail(event.target.value)}
          placeholder="you@example.com"
          required
          type="email"
          value={email}
        />
        {error ? (
          <p className="mt-2 text-sm text-[var(--danger)]" id="email-error" role="status">
            {error}
          </p>
        ) : null}
      </div>

      {/*
       * `disabled` only for the transient sending state, where removing it from
       * the tab order for ~1s is the point (no double submit). The COOLDOWN
       * state uses aria-disabled for the reason given on the resend button —
       * it lasts a minute, and a control that silently disappears for a minute
       * is worse than one that explains itself.
       */}
      <button
        aria-disabled={cooldown > 0}
        className="auth-primary-button"
        disabled={status === 'sending'}
        type="submit"
      >
        {status === 'sending'
          ? 'Sending…'
          : cooldown > 0
            ? `Wait ${cooldown}s`
            : 'Send sign-in link'}
        {status !== 'sending' && cooldown <= 0 ? (
          <svg aria-hidden="true" fill="none" height="16" viewBox="0 0 16 16" width="16">
            <path
              d="M3 8h9M9 4.5 12.5 8 9 11.5"
              stroke="currentColor"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="1.5"
            />
          </svg>
        ) : null}
      </button>
      <p className="text-center text-xs text-[var(--text-muted)]" id="email-hint">
        New here? An account is created automatically.
      </p>
    </form>
  );
}
