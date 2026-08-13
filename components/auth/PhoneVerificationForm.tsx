'use client';

/**
 * Minimal functional OTP form (F0.3).
 *
 * Every rule — the hourly cap, the attempt lockout, expiry — is enforced on
 * the server. This component only reflects what the server said; it must
 * never decide anything, and it never receives the code.
 */
import { useState, useTransition } from 'react';

type Step = 'enter_phone' | 'enter_code' | 'verified';

export function PhoneVerificationForm({ initialLevel }: { initialLevel: number }) {
  const [step, setStep] = useState<Step>(initialLevel >= 1 ? 'verified' : 'enter_phone');
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  async function post(path: string, body: unknown): Promise<{ ok: boolean; message?: string }> {
    const response = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return (await response.json()) as { ok: boolean; message?: string };
  }

  function requestCode(formData: FormData) {
    const phoneNumber = String(formData.get('phoneNumber') ?? '').trim();
    startTransition(async () => {
      const result = await post('/api/otp/request', { phoneNumber });
      setMessage(result.message ?? null);
      // The server answers identically whether or not the number is taken, so
      // the UI advances regardless — it cannot be used to enumerate accounts.
      setStep('enter_code');
    });
  }

  function verifyCode(formData: FormData) {
    const code = String(formData.get('code') ?? '').trim();
    startTransition(async () => {
      const result = await post('/api/otp/verify', { code });
      if (result.ok) {
        setStep('verified');
        setMessage('Phone verified.');
      } else {
        setMessage(result.message ?? 'That did not work.');
      }
    });
  }

  if (step === 'verified') {
    return <p className="text-[var(--success)]">Your phone number is verified.</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      {step === 'enter_phone' ? (
        <form action={requestCode} className="flex flex-col gap-2">
          <label className="text-sm" htmlFor="phoneNumber">
            Phone number (with country code, e.g. +919876543210)
          </label>
          <input
            className="rounded border border-[var(--border)] bg-[var(--surface)] px-3 py-2"
            id="phoneNumber"
            name="phoneNumber"
            type="tel"
            autoComplete="tel"
            required
          />
          <button
            className="rounded bg-[var(--accent)] px-3 py-2 font-medium text-[var(--accent-foreground)] disabled:opacity-60"
            type="submit"
            disabled={pending}
          >
            {pending ? 'Sending…' : 'Send code'}
          </button>
        </form>
      ) : (
        <form action={verifyCode} className="flex flex-col gap-2">
          <label className="text-sm" htmlFor="code">
            6-digit code
          </label>
          <input
            className="rounded border border-[var(--border)] bg-[var(--surface)] px-3 py-2 tracking-[0.4em]"
            id="code"
            name="code"
            inputMode="numeric"
            pattern="\d{6}"
            maxLength={6}
            autoComplete="one-time-code"
            required
          />
          <button
            className="rounded bg-[var(--accent)] px-3 py-2 font-medium text-[var(--accent-foreground)] disabled:opacity-60"
            type="submit"
            disabled={pending}
          >
            {pending ? 'Checking…' : 'Verify'}
          </button>
          <button
            className="text-sm text-[var(--text-muted)] underline"
            type="button"
            onClick={() => setStep('enter_phone')}
          >
            Use a different number
          </button>
        </form>
      )}

      {message ? (
        <p aria-live="polite" className="text-sm text-[var(--text-muted)]">
          {message}
        </p>
      ) : null}
    </div>
  );
}
