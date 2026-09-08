'use client';

/**
 * Resend from a failed-link page.
 *
 * Calls the SAME server action /login uses, so it goes through the same
 * server-side cooldown. A separate send path here would make this page a
 * bypass of the cooldown — and at a 15-minute TTL it is a page people reach
 * often enough for that to matter. See decisions D13.
 */
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { sendMagicLinkAction } from '../actions';

export function ResendPanel({ email }: { email: string }) {
  const [address, setAddress] = useState(email);
  const [message, setMessage] = useState<string | null>(null);
  const [tone, setTone] = useState<'ok' | 'error'>('ok');
  const [cooldown, setCooldown] = useState(0);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((seconds) => seconds - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  async function resend() {
    setPending(true);
    setMessage(null);
    try {
      const result = await sendMagicLinkAction({ email: address });
      if (result.ok) {
        setTone('ok');
        setMessage(`A new link is on its way to ${result.maskedEmail}.`);
        setCooldown(result.cooldownSeconds);
      } else {
        setTone('error');
        setMessage(result.message);
        // The cooldown is the server's answer, not this component's guess.
        if (result.retryAfterSeconds) setCooldown(result.retryAfterSeconds);
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <label className="auth-label" htmlFor="resend-email">
          Email address
        </label>
        <input
          autoComplete="email"
          className="auth-field"
          id="resend-email"
          onChange={(event) => setAddress(event.target.value)}
          placeholder="you@example.com"
          type="email"
          value={address}
        />
      </div>

      {/* aria-disabled rather than disabled — see LoginForm for why. */}
      <button
        aria-disabled={pending || cooldown > 0 || address.length === 0}
        className="auth-primary-button"
        onClick={() => {
          if (pending || cooldown > 0 || address.length === 0) return;
          void resend();
        }}
        type="button"
      >
        {pending ? 'Sending…' : cooldown > 0 ? `Resend in ${cooldown}s` : 'Send a new link'}
      </button>

      {message ? (
        <p
          className={
            tone === 'ok' ? 'text-sm text-[var(--success)]' : 'text-sm text-[var(--danger)]'
          }
          role="status"
        >
          {message}
        </p>
      ) : null}

      <Link
        className="text-center text-sm font-medium text-[var(--text-muted)] underline decoration-[var(--border)] underline-offset-4 hover:text-[var(--text-primary)]"
        href="/login"
      >
        Back to sign in
      </Link>
    </div>
  );
}
