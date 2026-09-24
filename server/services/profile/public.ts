/**
 * F4.7 · the public profile and its monthly share card.
 *
 * ## One gate, applied by the query
 *
 * A profile is visible only when `public_profile_enabled` is on, a handle is
 * set, and the account is not deleted — all three in the WHERE clause of the
 * one lookup every entry point goes through. Anything else is the same `null`
 * as a handle that does not exist, so a disabled profile cannot be told apart
 * from a missing one.
 *
 * ## Sections are not loaded when they are off
 *
 * Each section's query runs only if its toggle is on. The ticket's check is
 * that private data is absent from every public payload; the cheapest way to
 * guarantee that is never to read it, the same rule D34 applied to blind retry.
 */
import { and, count, countDistinct, desc, eq, gte, isNull, lt, sql } from 'drizzle-orm';
import type { Database } from '@/server/db';
import {
  problemTags,
  solveSessions,
  userProblems,
  userProfiles,
  users,
} from '@/server/db/schema';
import type { MonthlyCardView, PublicProfileView } from '@/lib/profile/public-view';
import { localDateFor, recomputeStreak } from '@/server/services/streak';
import { avatarAppearance } from './initials';

/** How many topics the public page lists. */
const TOPIC_LIMIT = 8;

type Owner = {
  userId: string;
  handle: string;
  displayName: string;
  avatarUrl: string | null;
  timezone: string;
  showStreak: boolean;
  showLongestStreak: boolean;
  showTotalSolved: boolean;
  showTopics: boolean;
};

async function findOwner(db: Database, rawHandle: string): Promise<Owner | null> {
  const handle = rawHandle.trim().toLowerCase();
  const [row] = await db
    .select({
      userId: users.id,
      handle: userProfiles.handle,
      displayName: userProfiles.displayName,
      avatarUrl: userProfiles.avatarUrl,
      timezone: users.timezone,
      showStreak: userProfiles.publicShowStreak,
      showLongestStreak: userProfiles.publicShowLongestStreak,
      showTotalSolved: userProfiles.publicShowTotalSolved,
      showTopics: userProfiles.publicShowTopics,
    })
    .from(userProfiles)
    .innerJoin(users, eq(users.id, userProfiles.userId))
    .where(
      and(
        eq(userProfiles.handle, handle),
        eq(userProfiles.publicProfileEnabled, true),
        isNull(users.deletedAt),
      ),
    )
    .limit(1);

  if (!row?.handle) return null;
  return {
    ...row,
    handle: row.handle,
    // A public profile without a display name shows its handle: never the email.
    displayName: row.displayName?.trim() || row.handle,
  };
}

/**
 * The live streak, recomputed on read (D19) rather than trusted from the cache.
 * A public page claiming a streak that already broke would be exactly the kind
 * of unverifiable number F4.7's honesty rule forbids.
 */
async function liveStreak(db: Database, owner: Owner, now: Date) {
  const state = await recomputeStreak(db, owner.userId, localDateFor(now, owner.timezone));
  return { current: state.currentStreak, longest: state.longestStreak };
}

export async function getPublicProfile(
  db: Database,
  input: { handle: string; now: Date },
): Promise<PublicProfileView | null> {
  const owner = await findOwner(db, input.handle);
  if (!owner) return null;

  const streak =
    owner.showStreak || owner.showLongestStreak ? await liveStreak(db, owner, input.now) : null;

  const [totalSolved, topics] = await Promise.all([
    owner.showTotalSolved
      ? db
          .select({ n: count() })
          .from(userProblems)
          .where(and(eq(userProblems.userId, owner.userId), eq(userProblems.status, 'solved')))
          .then(([row]) => row?.n ?? 0)
      : null,
    owner.showTopics
      ? db
          .select({
            topic: problemTags.tagValue,
            solved: countDistinct(userProblems.problemId),
          })
          .from(userProblems)
          .innerJoin(
            problemTags,
            and(
              eq(problemTags.problemId, userProblems.problemId),
              eq(problemTags.tagType, 'topic'),
            ),
          )
          .where(and(eq(userProblems.userId, owner.userId), eq(userProblems.status, 'solved')))
          .groupBy(problemTags.tagValue)
          .orderBy(desc(countDistinct(userProblems.problemId)), problemTags.tagValue)
          .limit(TOPIC_LIMIT)
      : null,
  ]);

  const appearance = avatarAppearance(owner.userId, owner.displayName, '');
  return {
    handle: owner.handle,
    displayName: owner.displayName,
    avatarUrl: owner.avatarUrl,
    appearance: {
      initials: appearance.initials,
      backgroundColor: appearance.backgroundColor,
      color: appearance.color,
    },
    currentStreak: owner.showStreak ? (streak?.current ?? 0) : null,
    longestStreak: owner.showLongestStreak ? (streak?.longest ?? 0) : null,
    totalSolved,
    topics,
  };
}

/** `YYYY-MM`, validated; anything else falls back to the owner's current month. */
function resolveMonth(requested: string | undefined, now: Date, timeZone: string): string {
  if (requested && /^\d{4}-(0[1-9]|1[0-2])$/.test(requested)) return requested;
  return localDateFor(now, timeZone).slice(0, 7);
}

function nextMonth(month: string): string {
  const [year, mon] = month.split('-').map(Number) as [number, number];
  return mon === 12 ? `${year + 1}-01` : `${year}-${String(mon + 1).padStart(2, '0')}`;
}

/**
 * One month, for the share card. Solves are counted by `ended_local_date` —
 * the day the streak credits (D18) — so the card agrees with the calendar.
 */
export async function getMonthlyCard(
  db: Database,
  input: { handle: string; month?: string; now: Date },
): Promise<MonthlyCardView | null> {
  const owner = await findOwner(db, input.handle);
  if (!owner) return null;

  const month = resolveMonth(input.month, input.now, owner.timezone);
  const from = `${month}-01`;
  const to = `${nextMonth(month)}-01`;
  const inMonth = and(
    eq(solveSessions.userId, owner.userId),
    eq(solveSessions.status, 'solved'),
    gte(solveSessions.endedLocalDate, from),
    lt(solveSessions.endedLocalDate, to),
  );

  const [solved, days, streak, topic] = await Promise.all([
    owner.showTotalSolved
      ? db
          .select({ n: countDistinct(solveSessions.problemId) })
          .from(solveSessions)
          .where(inMonth)
          .then(([row]) => row?.n ?? 0)
      : null,
    owner.showStreak
      ? db
          .select({ n: countDistinct(solveSessions.endedLocalDate) })
          .from(solveSessions)
          .where(inMonth)
          .then(([row]) => row?.n ?? 0)
      : null,
    owner.showStreak ? liveStreak(db, owner, input.now) : null,
    owner.showTopics
      ? db
          .select({ topic: problemTags.tagValue })
          .from(solveSessions)
          .innerJoin(
            problemTags,
            and(
              eq(problemTags.problemId, solveSessions.problemId),
              eq(problemTags.tagType, 'topic'),
            ),
          )
          .where(inMonth)
          .groupBy(problemTags.tagValue)
          .orderBy(desc(sql`count(distinct ${solveSessions.problemId})`), problemTags.tagValue)
          .limit(1)
          .then(([row]) => row?.topic ?? null)
      : null,
  ]);

  return {
    handle: owner.handle,
    displayName: owner.displayName,
    month,
    solvedThisMonth: solved,
    activeDays: days,
    currentStreak: streak?.current ?? null,
    topTopic: topic,
  };
}
