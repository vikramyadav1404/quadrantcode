/**
 * /login — one page for sign-in and sign-up.
 *
 * A magic link makes them the same operation: we do not know, and do not need
 * to know, whether the address has an account until the link is clicked. That
 * is also why the response is identical either way.
 */
import { LoginForm } from './LoginForm';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const returnTo = typeof params.returnTo === 'string' ? params.returnTo : undefined;

  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Sign in to TraceLoop</h1>
      <p className="mt-1 mb-6 text-sm text-[var(--text-muted)]">
        We&apos;ll email you a link. New here? The same link creates your account.
      </p>
      <LoginForm returnTo={returnTo} />
    </>
  );
}
