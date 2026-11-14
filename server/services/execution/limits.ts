/**
 * How much a user may run, and what they are told when they cannot.
 *
 * ## Both limits are counted in the database, not in memory
 *
 * The amendment to this ticket is explicit about the concurrency cap, and the
 * reason applies to both: two serverless invocations each counting their own
 * executions both see one. Counting rows is the only version that holds across
 * processes — the same argument the in-memory rate limiter loses in production
 * (F0.3), except here it is cheap to do properly.
 *
 * ## The message names the time
 *
 * "Too many requests" tells a user nothing they can act on. The criterion asks
 * for a reset time and these messages carry one, because the difference between
 * "wait four minutes" and "come back tomorrow" is the whole content of the
 * message.
 */
import { and, asc, eq, gt, gte, inArray, lt } from 'drizzle-orm';
import type { Database, Transaction } from '@/server/db';
import { executionJobs } from '@/server/db/schema';
import { LIVE_STATUSES } from './statemachine';

/** Executions per user per rolling hour. */
export const HOURLY_LIMIT = 20;

/** Executions a user may have in flight at once. */
export const CONCURRENT_LIMIT = 5;

/**
 * Executions the whole site may admit per UTC day, unless
 * `EXECUTION_GLOBAL_DAILY_LIMIT` says otherwise.
 *
 * Twenty was set as a conservative guard for Vercel Sandbox's Hobby allowance.
 * Production now runs on a self-hosted Judge0, where the right number depends
 * on that server, not on a platform quota — so it is a setting, changed in
 * Vercel and picked up on the next deploy, with no code change.
 */
export const DEFAULT_GLOBAL_DAILY_LIMIT = 20;

/** Ceiling on the setting, so a slipped extra zero cannot open the gate wide. */
export const MAX_GLOBAL_DAILY_LIMIT = 100_000;

/**
 * The shared daily allowance in force.
 *
 * Unset, blank or unusable falls back to the default rather than throwing:
 * this runs on every Submit, and a bad value is caught earlier and louder by
 * `server/env.ts`, which refuses it in `npm run deploy:check` before a build
 * can ship it.
 */
export function globalDailyLimit(
  source: Record<string, string | undefined> = process.env,
): number {
  const raw = source.EXECUTION_GLOBAL_DAILY_LIMIT?.trim();
  if (!raw || !/^\d+$/.test(raw)) return DEFAULT_GLOBAL_DAILY_LIMIT;
  const value = Number(raw);
  return value >= 1 && value <= MAX_GLOBAL_DAILY_LIMIT ? value : DEFAULT_GLOBAL_DAILY_LIMIT;
}

/** Database-enforced ceiling below Vercel's platform concurrency quota. */
export const GLOBAL_SANDBOX_CONCURRENCY = 8;

const HOUR_MS = 60 * 60 * 1000;

export type LimitVerdict =
  | { allowed: true }
  | {
      allowed: false;
      reason: 'hourly' | 'concurrent' | 'global_daily';
      message: string;
      /** When the user may try again. Always set for the hourly limit. */
      retryAt: Date | null;
    };

/**
 * May this user start another execution right now?
 *
 * Checked before the row is written, so a refused submission leaves nothing
 * behind — otherwise a user hammering the button would fill the table with
 * jobs that exist only to be rejected.
 */
export async function checkExecutionLimits(
  db: Database | Transaction,
  input: { userId: string; now: Date },
): Promise<LimitVerdict> {
  const { userId, now } = input;
  const windowStart = new Date(now.getTime() - HOUR_MS);
  const utcDayStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  const nextUtcDay = new Date(utcDayStart.getTime() + 24 * HOUR_MS);

  const [live, recent, globalToday] = await Promise.all([
    db
      .select({ id: executionJobs.id })
      .from(executionJobs)
      .where(
        and(
          eq(executionJobs.userId, userId),
          inArray(executionJobs.status, [...LIVE_STATUSES]),
        ),
      ),

    db
      .select({ createdAt: executionJobs.createdAt })
      .from(executionJobs)
      .where(and(eq(executionJobs.userId, userId), gt(executionJobs.createdAt, windowStart)))
      .orderBy(asc(executionJobs.createdAt)),

    db
      .select({ id: executionJobs.id })
      .from(executionJobs)
      .where(
        and(gte(executionJobs.createdAt, utcDayStart), lt(executionJobs.createdAt, nextUtcDay)),
      ),
  ]);

  if (live.length >= CONCURRENT_LIMIT) {
    return {
      allowed: false,
      reason: 'concurrent',
      message: `You already have ${live.length} runs in flight. Wait for one to finish.`,
      /*
       * No time, on purpose. A concurrent limit clears when a run finishes, not
       * at a clock time, and inventing one would be a promise nothing keeps.
       */
      retryAt: null,
    };
  }

  if (recent.length >= HOURLY_LIMIT) {
    /*
     * The window is rolling, so the moment capacity returns is one hour after
     * the OLDEST run still inside it — not one hour from now.
     */
    const oldest = recent[0]!.createdAt;
    const retryAt = new Date(oldest.getTime() + HOUR_MS);

    return {
      allowed: false,
      reason: 'hourly',
      message: `That is ${HOURLY_LIMIT} runs this hour. You can run again at ${formatTime(retryAt)}.`,
      retryAt,
    };
  }

  if (globalToday.length >= globalDailyLimit()) {
    return {
      allowed: false,
      reason: 'global_daily',
      message: `Today's shared execution allowance is full. Try again at ${nextUtcDay.toISOString()}.`,
      retryAt: nextUtcDay,
    };
  }

  return { allowed: true };
}

/** 24-hour clock, because "at 3" is ambiguous and this message is about time. */
function formatTime(when: Date): string {
  return when.toISOString().slice(11, 16);
}
