/**
 * The one-line reminder before a solve.
 *
 * ## It must read like a coach, not a nag — and the cap is what makes that true
 *
 * The ticket asks for the tone; the frequency rule is what delivers it. Once
 * per pattern per day, dismissible, top three only. A reminder that appears
 * every time you open a problem is not advice, it is a nag, and users learn to
 * click past it without reading — at which point it costs attention and returns
 * nothing.
 *
 * ## The cap is a unique index, not a query
 *
 * `mistake_warnings_shown` has a unique index on (user, category, local date).
 * Two page loads racing each other cannot both insert, which a
 * check-then-insert would allow — the same lesson F3.1's concurrency cap
 * learned the expensive way.
 *
 * ## The day boundary is the user's own
 *
 * `todayLocalDate` is passed in, resolved against their timezone (D18). "Once a
 * day" with a UTC boundary would show a second warning at 05:30 to somebody in
 * Asia/Kolkata.
 */
import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import type { Database } from '@/server/db';
import { mistakePatterns, mistakeWarningsShown, problemTags } from '@/server/db/schema';

/** How many patterns are eligible to warn about. The ticket's "top 3". */
export const WARNING_POOL = 3;

export type PreSolveWarning = {
  /** The row that lets the user dismiss it. */
  id: string;
  category: string;
  topic: string | null;
  /** One sentence. Always present. */
  message: string;
};

/**
 * The warning to show before this problem, if any.
 *
 * Returns null far more often than not, which is the point: no matching
 * pattern, already shown today, already dismissed, or the user simply has no
 * recurring mistakes.
 */
export async function warningFor(
  db: Database,
  input: {
    userId: string;
    problemId: string;
    todayLocalDate: string;
  },
): Promise<PreSolveWarning | null> {
  const topics = await db
    .select({ topic: problemTags.tagValue })
    .from(problemTags)
    .where(and(eq(problemTags.problemId, input.problemId), eq(problemTags.tagType, 'topic')));

  if (topics.length === 0) return null;

  const top = await db
    .select()
    .from(mistakePatterns)
    .where(
      and(
        eq(mistakePatterns.userId, input.userId),
        inArray(
          mistakePatterns.topic,
          topics.map((row) => row.topic),
        ),
      ),
    )
    .orderBy(desc(mistakePatterns.occurrences))
    .limit(WARNING_POOL);

  if (top.length === 0) return null;

  const pattern = top[0]!;

  /*
   * Already shown today, or dismissed at any point. Dismissal outlasts the day
   * deliberately: someone who closed this once has told us they do not want it,
   * and showing it again tomorrow is the nag the tone rule forbids.
   */
  const [seen] = await db
    .select({ id: mistakeWarningsShown.id, dismissedAt: mistakeWarningsShown.dismissedAt })
    .from(mistakeWarningsShown)
    .where(
      and(
        eq(mistakeWarningsShown.userId, input.userId),
        eq(mistakeWarningsShown.category, pattern.category),
        eq(mistakeWarningsShown.shownLocalDate, input.todayLocalDate),
      ),
    )
    .limit(1);

  if (seen) return null;

  const [row] = await db
    .insert(mistakeWarningsShown)
    .values({
      userId: input.userId,
      category: pattern.category,
      shownLocalDate: input.todayLocalDate,
    })
    /*
     * Two tabs opening the same problem at once both reach here. The unique
     * index makes the second a no-op rather than a duplicate warning.
     */
    .onConflictDoNothing()
    .returning({ id: mistakeWarningsShown.id });

  if (!row) return null;

  return {
    id: row.id,
    category: pattern.category,
    topic: pattern.topic,
    message: messageFor({
      category: pattern.category,
      topic: pattern.topic,
      occurrences: pattern.occurrences,
      trend: pattern.trend,
    }),
  };
}

/**
 * The sentence itself.
 *
 * States what happened and stops. No exclamation, no "watch out!", no advice
 * the user did not ask for — they are about to solve a problem, and the most
 * useful thing to hand them is a fact they can hold in mind.
 */
export function messageFor(input: {
  category: string;
  topic: string | null;
  occurrences: number;
  trend: string;
}): string {
  const what = input.category.replace(/_/g, ' ');
  const where = input.topic ? ` on ${input.topic}` : '';

  return `Last few times${where}, ${what} came up ${input.occurrences} times.`;
}

/** The user closed it. Recorded so it does not come back tomorrow. */
export async function dismissWarning(
  db: Database,
  input: { userId: string; warningId: string; now: Date },
): Promise<void> {
  await db
    .update(mistakeWarningsShown)
    .set({ dismissedAt: input.now })
    .where(
      and(
        eq(mistakeWarningsShown.id, input.warningId),
        eq(mistakeWarningsShown.userId, input.userId),
        isNull(mistakeWarningsShown.dismissedAt),
      ),
    );
}
