'use server';

/**
 * Daily-goal settings.
 *
 * A goal change is EFFECTIVE FROM today, never retroactive: `daily_goals` is
 * keyed on `(user_id, effective_from)` and the recompute reads whichever row
 * applied on each day. Raising a target must not un-complete last month, which
 * is D18's immutability principle applied to the goal rather than the timezone.
 */
import { revalidatePath } from 'next/cache';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '@/server/db';
import { dailyGoals, users } from '@/server/db/schema';
import { requireCurrentUser } from '@/server/services/auth/session';
import { localDateFor, recomputeStreak } from '@/server/services/streak';

const schema = z
  .object({
    targetProblems: z.coerce.number().int().min(1).max(20),
    minMedium: z.coerce.number().int().min(0).max(20),
    reminderTimeLocal: z.string().regex(/^\d{2}:\d{2}$/),
    timezone: z.string().min(1).max(64),
  })
  .refine((value) => value.minMedium <= value.targetProblems, {
    message: 'Minimum mediums cannot exceed the daily target',
    path: ['minMedium'],
  });

export type SaveGoalsResult = { ok: true } | { ok: false; message: string };

export async function saveGoalsAction(input: unknown): Promise<SaveGoalsResult> {
  const user = await requireCurrentUser();

  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? 'Those settings are not valid.',
    };
  }

  const { targetProblems, minMedium, reminderTimeLocal, timezone } = parsed.data;
  const db = getDb();

  /*
   * The timezone is validated by a TRIGGER on `users` (a CHECK cannot hold a
   * subquery against pg_timezone_names), so an invalid zone is rejected by the
   * database rather than trusted from this form.
   */
  try {
    await db.update(users).set({ timezone }).where(eq(users.id, user.id));
  } catch {
    return { ok: false, message: 'That is not a recognised timezone.' };
  }

  // "Today" in the NEW zone — a goal set after a zone change applies from the
  // user's current day, not the server's.
  const today = localDateFor(new Date(), timezone);

  await db
    .insert(dailyGoals)
    .values({
      userId: user.id,
      effectiveFrom: today,
      targetProblems,
      minMedium,
      reminderTimeLocal: `${reminderTimeLocal}:00`,
    })
    // Targeted per D16: re-saving on the same day updates that day's goal
    // rather than failing or creating a second row.
    .onConflictDoUpdate({
      target: [dailyGoals.userId, dailyGoals.effectiveFrom],
      set: { targetProblems, minMedium, reminderTimeLocal: `${reminderTimeLocal}:00` },
    });

  // The change can alter which past days completed, so the streak is rebuilt.
  await recomputeStreak(db, user.id, today);

  revalidatePath('/settings/goals');
  revalidatePath('/dashboard');
  return { ok: true };
}
