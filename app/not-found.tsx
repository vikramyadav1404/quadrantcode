import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="auth-shell grid min-h-dvh place-items-center px-6">
      <div className="max-w-md text-center">
        <p className="font-mono text-sm text-[var(--accent)]">404 · OUT OF QUADRANT</p>
        <h1 className="mt-4 text-4xl font-semibold tracking-[-0.04em]">
          That page is not here.
        </h1>
        <p className="mt-3 text-[var(--text-muted)]">
          The link may be old, or the page may have moved.
        </p>
        <Link className="auth-primary-button mt-7 inline-flex w-auto px-6" href="/">
          Back to Quadrantcode
        </Link>
      </div>
    </main>
  );
}
