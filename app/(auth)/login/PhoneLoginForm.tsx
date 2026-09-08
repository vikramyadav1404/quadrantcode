'use client';

/**
 * Sign in with a phone number: enter_phone → enter_code.
 *
 * ## It advances even when nothing was sent
 *
 * `/api/auth/phone/request` answers identically for a registered number, an
 * unregistered one and a rate-limited one — that is the whole design, so that
 * this form cannot be used to find out who has an account. The consequence is
 * that this component **must not branch on the answer**: showing the code field
 * only when a code was really sent would put the leak back in the UI after the
 * API went to such lengths to keep it out.
 *
 * So it always advances. Someone who typed a number with no account gets a code
 * field and a wrong-code message, which is exactly what someone who mistyped a
 * real number gets.
 *
 * ## Nothing here decides anything
 *
 * Same rule as `LoginForm`: the server owns the cooldown, the attempt limit and
 * the expiry. This reflects what it said. `PhoneVerificationForm` (settings)
 * carries the same comment for the same reason.
 */
import { useState, useTransition } from 'react';

type Step = 'enter_phone' | 'enter_code';

type ApiResult = { ok: boolean; message: string };

export function PhoneLoginForm({ returnTo }: { returnTo?: string }) {
  const [step, setStep] = useState<Step>('enter_phone');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [code, setCode] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [pending, startTransition] = useTransition();

  /**
   * Always resolves to an `ApiResult`, never throws.
   *
   * The first version assumed a JSON body. When the request endpoint returned
   * a 500 — which it did, because the console OTP provider refuses under
   * NODE_ENV=production — `response.json()` rejected inside `startTransition`,
   * `pending` never cleared, and the button sat on "Sending…" for good with
   * nothing said. A dead form is a worse failure than a rude message.
   *
   * So a transport or parse failure becomes an ordinary refusal. It is
   * deliberately vague: the user cannot act on the difference between "the
   * server is down" and "the server sent something unparseable", and the detail
   * belongs in the server's logs, which have it.
   */
  async function post(path: string, body: unknown): Promise<ApiResult> {
    try {
      const response = await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      return (await response.json()) as ApiResult;
    } catch {
      return { ok: false, message: 'Could not reach the server. Try again.' };
    }
  }

  function requestCode() {
    startTransition(async () => {
      const result = await post('/api/auth/phone/request', { phoneNumber });
      setMessage(result.message);

      /*
       * An invalid NUMBER keeps us on this step — that is a claim about the
       * string typed, not about who has an account, and moving on would ask for
       * a code that was never going to arrive. Every other outcome advances.
       */
      const invalidNumber = !result.ok;
      setFailed(invalidNumber);
      if (!invalidNumber) setStep('enter_code');
    });
  }

  function submitCode() {
    startTransition(async () => {
      const result = await post('/api/auth/phone/verify', { phoneNumber, code });

      if (result.ok) {
        /*
         * A full navigation, not a router push. The session cookie arrived on
         * this response, and every server component that gates on it has to be
         * re-rendered by the server — a client-side transition would carry the
         * cached signed-out tree straight into the app shell.
         */
        window.location.assign(returnTo ?? '/dashboard');
        return;
      }

      setFailed(true);
      setMessage(result.message);
    });
  }

  if (step === 'enter_code') {
    return (
      <form
        className="flex flex-col gap-5"
        onSubmit={(event) => {
          event.preventDefault();
          submitCode();
        }}
      >
        <div>
          <label className="auth-label" htmlFor="phone-code">
            Six-digit code
          </label>
          <input
            aria-describedby={message ? 'phone-message' : 'phone-code-hint'}
            aria-invalid={failed}
            autoComplete="one-time-code"
            className="auth-field text-center font-mono text-lg tracking-[0.35em]"
            id="phone-code"
            inputMode="numeric"
            maxLength={6}
            name="code"
            onChange={(event) => setCode(event.target.value)}
            placeholder="000000"
            required
            value={code}
          />
          <p className="mt-2 text-xs leading-5 text-[var(--text-muted)]" id="phone-code-hint">
            Enter the code sent to {phoneNumber}.
          </p>
          {message ? (
            <p
              className={`mt-2 text-sm ${failed ? 'text-[var(--danger)]' : 'text-[var(--text-muted)]'}`}
              id="phone-message"
              role="status"
            >
              {message}
            </p>
          ) : null}
        </div>

        <button className="auth-primary-button" disabled={pending} type="submit">
          {pending ? 'Checking…' : 'Sign in'}
        </button>

        <button
          className="mx-auto block text-sm font-medium text-[var(--text-muted)] underline decoration-[var(--border)] underline-offset-4 hover:text-[var(--text-primary)]"
          onClick={() => {
            setStep('enter_phone');
            setMessage(null);
            setFailed(false);
            setCode('');
          }}
          type="button"
        >
          Use a different number
        </button>
      </form>
    );
  }

  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={(event) => {
        event.preventDefault();
        requestCode();
      }}
    >
      <div>
        <label className="auth-label" htmlFor="phone-number">
          Phone number
        </label>
        <input
          aria-describedby={message ? 'phone-message' : 'phone-hint'}
          aria-invalid={failed}
          autoComplete="tel"
          className="auth-field"
          id="phone-number"
          inputMode="tel"
          name="phoneNumber"
          onChange={(event) => setPhoneNumber(event.target.value)}
          placeholder="+91 98765 43210"
          required
          type="tel"
          value={phoneNumber}
        />

        <p className="mt-2 text-xs leading-5 text-[var(--text-muted)]" id="phone-hint">
          Include the country code. Phone sign-in works after your number has been verified in
          account settings.
        </p>
        {message ? (
          <p className="mt-2 text-sm text-[var(--danger)]" id="phone-message" role="status">
            {message}
          </p>
        ) : null}
      </div>

      <button className="auth-primary-button" disabled={pending} type="submit">
        {pending ? 'Sending…' : 'Send code'}
      </button>
    </form>
  );
}
