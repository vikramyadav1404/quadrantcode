/**
 * F4.7 · a public profile, at `/u/<handle>`.
 *
 * Public on purpose and outside the `(app)` group, so it needs no session. It
 * renders only `PublicProfileView` — the type is the privacy contract — and a
 * profile that is off, unhandled or deleted is the same 404 as one that never
 * existed.
 *
 * `noindex`: the owner chose to be reachable by a link. Being listed by search
 * engines is a further exposure they were not asked about, so it is not
 * assumed. The share cards are the intended way to be found.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Avatar } from '@/components/avatar/Avatar';
import { QuadrantMark } from '@/components/brand/QuadrantMark';
import { getDb } from '@/server/db';
import { getPublicProfile } from '@/server/services/profile';

type Params = { params: Promise<{ handle: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { handle } = await params;
  const profile = await getPublicProfile(getDb(), { handle, now: new Date() });
  if (!profile) return { title: 'Not found · Quadrantcode', robots: { index: false } };

  const title = `${profile.displayName} · Quadrantcode`;
  const description = `${profile.displayName}'s practice on Quadrantcode.`;
  return {
    title,
    description,
    robots: { index: false, follow: false },
    openGraph: {
      title,
      description,
      images: [{ url: `/u/${profile.handle}/card/linkedin`, width: 1200, height: 627 }],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: [`/u/${profile.handle}/card/x`],
    },
  };
}

export default async function PublicProfilePage({ params }: Params) {
  const { handle } = await params;
  const profile = await getPublicProfile(getDb(), { handle, now: new Date() });
  if (!profile) notFound();

  const stats = [
    profile.currentStreak !== null
      ? { label: 'Current streak', value: `${profile.currentStreak} days` }
      : null,
    profile.longestStreak !== null
      ? { label: 'Longest streak', value: `${profile.longestStreak} days` }
      : null,
    profile.totalSolved !== null
      ? { label: 'Problems solved', value: String(profile.totalSolved) }
      : null,
  ].filter((stat): stat is { label: string; value: string } => stat !== null);

  return (
    <div className="min-h-dvh bg-[var(--background)]">
      <header className="mx-auto flex w-full max-w-3xl items-center justify-between px-5 py-5">
        <Link className="flex items-center gap-3" href="/">
          <QuadrantMark />
          <span className="text-base font-semibold">Quadrantcode</span>
        </Link>
      </header>

      <main className="mx-auto w-full max-w-3xl px-5 pb-16" id="main">
        <section className="flex items-center gap-4">
          <Avatar alt="" appearance={profile.appearance} size={72} src={profile.avatarUrl} />
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{profile.displayName}</h1>
            <p className="text-sm text-[var(--text-muted)]">@{profile.handle}</p>
          </div>
        </section>

        {stats.length > 0 ? (
          <dl className="mt-8 grid gap-3 sm:grid-cols-3">
            {stats.map((stat) => (
              <div
                className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-4"
                key={stat.label}
              >
                <dt className="text-xs text-[var(--text-muted)]">{stat.label}</dt>
                <dd className="mt-1 text-2xl font-semibold tabular-nums">{stat.value}</dd>
              </div>
            ))}
          </dl>
        ) : null}

        {profile.topics ? (
          <section aria-label="Topic distribution" className="mt-8">
            <h2 className="text-lg font-semibold">Solved by topic</h2>
            {profile.topics.length === 0 ? (
              <p className="mt-2 text-sm text-[var(--text-muted)]">Nothing solved yet.</p>
            ) : (
              <ul className="mt-3 flex flex-col gap-2">
                {profile.topics.map((entry) => (
                  <li className="flex justify-between gap-3 text-sm" key={entry.topic}>
                    <span>{entry.topic}</span>
                    <span className="tabular-nums text-[var(--text-muted)]">
                      {entry.solved}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ) : null}

        {stats.length === 0 && !profile.topics ? (
          <p className="mt-8 text-sm text-[var(--text-muted)]">
            {profile.displayName} keeps their numbers private.
          </p>
        ) : null}
      </main>
    </div>
  );
}
