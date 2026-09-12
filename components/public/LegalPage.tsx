import Link from 'next/link';
import { QuadrantMark } from '@/components/brand/QuadrantMark';

export function LegalPage({
  title,
  intro,
  children,
}: {
  title: string;
  intro: string;
  children: React.ReactNode;
}) {
  return (
    <div className="auth-shell min-h-dvh">
      <header className="mx-auto flex max-w-4xl items-center justify-between px-5 py-6">
        <Link className="flex items-center gap-3 font-semibold" href="/">
          <QuadrantMark /> Quadrantcode
        </Link>
        <Link
          className="text-sm text-[var(--text-muted)] hover:text-[var(--text-primary)]"
          href="/login"
        >
          Sign in
        </Link>
      </header>
      <main className="mx-auto max-w-4xl px-5 py-14 sm:py-20">
        <p className="text-xs font-bold tracking-[0.16em] text-[var(--accent)] uppercase">
          Last updated · 31 August 2026
        </p>
        <h1 className="mt-3 text-4xl font-semibold tracking-[-0.045em] sm:text-5xl">{title}</h1>
        <p className="mt-5 max-w-2xl text-lg leading-8 text-[var(--text-muted)]">{intro}</p>
        <div className="mt-12 grid gap-8 text-sm leading-7 text-[var(--text-muted)] [&_h2]:mb-2 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:text-[var(--text-primary)] [&_a]:text-[var(--accent)] [&_a]:underline">
          {children}
        </div>
      </main>
    </div>
  );
}
