/**
 * F4.2 · a track as one user sees it: progress, locks, next step, time left.
 *
 * Two queries per track — the catalog rows for its slugs, and this user's
 * solved rows for those problems — then everything else is computed in memory.
 */
import { and, eq, inArray } from 'drizzle-orm';
import type { Database } from '@/server/db';
import { problems, userProblems } from '@/server/db/schema';
import type { TrackSectionView, TrackSummaryView, TrackView } from '@/lib/tracks/view';
import { type Track, TRACKS } from './catalog';
import { remainingMinutes, speedProfile } from './estimate';

export class TrackNotFoundError extends Error {
  readonly code = 'TRACK_NOT_FOUND' as const;
  constructor() {
    super('No such track.');
    this.name = 'TrackNotFoundError';
  }
}

export async function getTrack(
  db: Database,
  input: { userId: string; slug: string; tracks?: readonly Track[] },
): Promise<TrackView> {
  const track = (input.tracks ?? TRACKS).find((candidate) => candidate.slug === input.slug);
  if (!track) throw new TrackNotFoundError();

  const declared = track.sections.flatMap((section) => section.slugs);

  // Only what a user could open from the catalog: published, external links.
  // Originals are not in any track today (see catalog.ts), and a premium
  // problem would need entitlements F4.4 would have provided.
  const rows = await db
    .select({
      id: problems.id,
      slug: problems.slug,
      title: problems.title,
      difficulty: problems.difficulty,
      estimatedMinutes: problems.estimatedMinutes,
    })
    .from(problems)
    .where(
      and(
        inArray(problems.slug, declared),
        eq(problems.status, 'published'),
        eq(problems.sourceType, 'external_link'),
        eq(problems.isPremium, false),
      ),
    );
  const bySlug = new Map(rows.map((row) => [row.slug, row]));

  const solvedRows =
    rows.length === 0
      ? []
      : await db
          .select({
            problemId: userProblems.problemId,
            bestTimeSeconds: userProblems.bestTimeSeconds,
          })
          .from(userProblems)
          .where(
            and(
              eq(userProblems.userId, input.userId),
              eq(userProblems.status, 'solved'),
              inArray(
                userProblems.problemId,
                rows.map((row) => row.id),
              ),
            ),
          );
  const solvedIds = new Set(solvedRows.map((row) => row.problemId));

  // Speed is learned from this track's solved problems only. Solves from the
  // whole catalog would be more data, but the ticket's rule is "comparable
  // difficulty", and this keeps the estimate about the problems it prices.
  const profile = speedProfile(
    solvedRows.flatMap((row) => {
      const problem = rows.find((candidate) => candidate.id === row.problemId);
      return problem && row.bestTimeSeconds
        ? [
            {
              difficulty: problem.difficulty,
              bestSeconds: row.bestTimeSeconds,
              estimatedMinutes: problem.estimatedMinutes,
            },
          ]
        : [];
    }),
  );

  const titleOf = new Map(track.sections.map((section) => [section.id, section.title]));
  const completeIds = new Set<string>();
  const sections: TrackSectionView[] = [];

  // Sections are declared in order, and a prerequisite is always an earlier
  // section, so one pass decides every lock.
  for (const section of track.sections) {
    const present = section.slugs.flatMap((slug) => {
      const row = bySlug.get(slug);
      return row
        ? [
            {
              slug: row.slug,
              title: row.title,
              difficulty: row.difficulty,
              solved: solvedIds.has(row.id),
            },
          ]
        : [];
    });
    const solved = present.filter((problem) => problem.solved).length;
    const complete = present.length > 0 && solved === present.length;
    if (complete) completeIds.add(section.id);
    sections.push({
      id: section.id,
      title: section.title,
      requires: section.requires.map((id) => titleOf.get(id) ?? id),
      unlocked: section.requires.every((id) => completeIds.has(id)),
      complete,
      solved,
      problems: present,
    });
  }

  const all = sections.flatMap((section) => section.problems);
  const solvedCount = all.filter((problem) => problem.solved).length;
  const nextProblem = sections
    .filter((section) => section.unlocked && !section.complete)
    .flatMap((section) => section.problems)
    .find((problem) => !problem.solved);

  const unsolved = rows.filter((row) => !solvedIds.has(row.id));

  return {
    slug: track.slug,
    title: track.title,
    description: track.description,
    sections,
    total: all.length,
    solved: solvedCount,
    percent: all.length === 0 ? 0 : Math.round((solvedCount / all.length) * 100),
    next: nextProblem ? { slug: nextProblem.slug, title: nextProblem.title } : null,
    remainingMinutes: remainingMinutes(unsolved, profile),
    estimateFromDefaults: profile.overall === null,
    unavailable: declared.length - rows.length,
  };
}

export async function listTracks(
  db: Database,
  input: { userId: string; tracks?: readonly Track[] },
): Promise<TrackSummaryView[]> {
  const tracks = input.tracks ?? TRACKS;
  return Promise.all(
    tracks.map(async (track) => {
      const view = await getTrack(db, { userId: input.userId, slug: track.slug, tracks });
      return {
        slug: view.slug,
        title: view.title,
        description: view.description,
        total: view.total,
        solved: view.solved,
        percent: view.percent,
      };
    }),
  );
}
