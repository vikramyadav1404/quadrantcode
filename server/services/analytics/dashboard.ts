/**
 * Everything the dashboard shows, read from the rollup.
 *
 * **No raw session is touched here.** Every number comes from
 * `analytics_*_daily`, which is the whole reason the page stays fast at six
 * months — and the reason the page has to say when those rows were computed
 * rather than implying they are live.
 *
 * Four queries, whatever the history length: three rollup tables and the streak
 * row. The aggregation across days happens in memory over a few hundred narrow
 * rows, which is cheaper than making Postgres group them on every load.
 */
import { and, desc, eq, gte } from 'drizzle-orm';
import type { Database } from '@/server/db';
import {
  analyticsDaily,
  analyticsStuckDaily,
  analyticsTopicDaily,
  userStreaks,
} from '@/server/db/schema';
import { type LocalDate, localDateRange, previousLocalDate } from '@/server/services/streak';
import { type WeakTopic, rankWeakTopics } from './scoring';

/**
 * How far back the topic and stuck reads go.
 *
 * Six months, matching what the ticket asks the page to stay fast at. The
 * headline totals are NOT windowed — "total solved" means total — but a topic
 * table covering three years would be reporting on a person who no longer
 * exists, and the staleness component saturates at three weeks anyway.
 */
export const WINDOW_DAYS = 180;

/** Buckets on the speed trend, each seven days wide. */
export const TREND_WEEKS = 12;

export type TopicRow = {
  topic: string;
  solvedCount: number;
  stuckCount: number;
  sessionCount: number;
  averageActiveSeconds: number | null;
  failedAttemptRatio: number;
  averageConfidence: number | null;
  lastPractisedDate: LocalDate | null;
};

export type TrendPoint = {
  /** First day of the seven-day bucket. */
  weekStart: LocalDate;
  /** Active minutes per problem solved, or null when nothing was solved that week. */
  averageMinutesPerProblem: number | null;
};

export type DashboardData = {
  /** When the rollup behind these numbers was computed. Null when nothing is rolled up yet. */
  asOf: Date | null;
  /** True when older days are still waiting to be rolled up. */
  catchingUp: boolean;
  headline: {
    currentStreak: number;
    longestStreak: number;
    totalSolved: number;
    solvedThisWeek: number;
    averageActiveSeconds: number | null;
  };
  difficulty: { easy: number; medium: number; hard: number };
  topics: TopicRow[];
  weakTopics: WeakTopic[];
  trend: TrendPoint[];
  stuckDistribution: { category: string; marked: number; reflected: number }[];
};

export async function readDashboard(
  db: Database,
  input: { userId: string; today: LocalDate; asOf: Date | null; catchingUp: boolean },
): Promise<DashboardData> {
  const { userId, today } = input;
  const windowStart = previousLocalDate(today, WINDOW_DAYS - 1);
  const weekStart = previousLocalDate(today, 6);

  const [days, topicDays, stuckDays, [streak]] = await Promise.all([
    db
      .select()
      .from(analyticsDaily)
      .where(eq(analyticsDaily.userId, userId))
      .orderBy(desc(analyticsDaily.localDate)),

    db
      .select()
      .from(analyticsTopicDaily)
      .where(
        and(
          eq(analyticsTopicDaily.userId, userId),
          gte(analyticsTopicDaily.localDate, windowStart),
        ),
      ),

    db
      .select()
      .from(analyticsStuckDaily)
      .where(
        and(
          eq(analyticsStuckDaily.userId, userId),
          gte(analyticsStuckDaily.localDate, windowStart),
        ),
      ),

    db.select().from(userStreaks).where(eq(userStreaks.userId, userId)).limit(1),
  ]);

  const totalSolved = sum(days, (day) => day.solvedCount);
  const totalActiveSeconds = sum(days, (day) => day.activeSeconds);
  const totalSessions = sum(days, (day) => day.sessionCount);

  const solvedThisWeek = sum(
    days.filter((day) => day.localDate >= weekStart),
    (day) => day.solvedCount,
  );

  return {
    asOf: input.asOf,
    catchingUp: input.catchingUp,

    headline: {
      currentStreak: streak?.currentStreak ?? 0,
      longestStreak: streak?.longestStreak ?? 0,
      totalSolved,
      solvedThisWeek,
      /*
       * Per SESSION, not per solve. A sitting that ended stuck still cost the
       * time it cost, and averaging only over solves would report a number the
       * user has never experienced.
       */
      averageActiveSeconds:
        totalSessions > 0 ? Math.round(totalActiveSeconds / totalSessions) : null,
    },

    difficulty: {
      easy: sum(days, (day) => day.easySolved),
      medium: sum(days, (day) => day.mediumSolved),
      hard: sum(days, (day) => day.hardSolved),
    },

    topics: buildTopicRows(topicDays),
    weakTopics: buildWeakTopics(topicDays, today),
    trend: buildTrend(days, today),
    stuckDistribution: buildStuckDistribution(stuckDays),
  };
}

type TopicDayRow = typeof analyticsTopicDaily.$inferSelect;
type DayRow = typeof analyticsDaily.$inferSelect;
type StuckDayRow = typeof analyticsStuckDaily.$inferSelect;

/** Sum the per-day topic rows into one row per topic, most practised first. */
function buildTopicRows(topicDays: readonly TopicDayRow[]): TopicRow[] {
  const byTopic = groupTopics(topicDays);

  return [...byTopic.values()]
    .map((totals) => ({
      topic: totals.topic,
      solvedCount: totals.solvedCount,
      stuckCount: totals.stuckCount,
      sessionCount: totals.sessionCount,
      averageActiveSeconds:
        totals.sessionCount > 0 ? Math.round(totals.activeSeconds / totals.sessionCount) : null,
      failedAttemptRatio: totals.sessionCount > 0 ? totals.stuckCount / totals.sessionCount : 0,
      averageConfidence:
        totals.confidenceCount > 0 ? totals.confidenceSum / totals.confidenceCount : null,
      lastPractisedDate: totals.lastPractisedDate,
    }))
    .sort(
      (left, right) =>
        right.sessionCount - left.sessionCount || left.topic.localeCompare(right.topic),
    );
}

function buildWeakTopics(topicDays: readonly TopicDayRow[], today: LocalDate): WeakTopic[] {
  return rankWeakTopics([...groupTopics(topicDays).values()], today);
}

/** One accumulator per topic — the shape `scoreTopic` takes. */
function groupTopics(topicDays: readonly TopicDayRow[]) {
  const byTopic = new Map<
    string,
    {
      topic: string;
      solvedCount: number;
      stuckCount: number;
      sessionCount: number;
      activeSeconds: number;
      estimatedSeconds: number;
      confidenceSum: number;
      confidenceCount: number;
      lastPractisedDate: LocalDate | null;
    }
  >();

  for (const row of topicDays) {
    const totals = byTopic.get(row.topic) ?? {
      topic: row.topic,
      solvedCount: 0,
      stuckCount: 0,
      sessionCount: 0,
      activeSeconds: 0,
      estimatedSeconds: 0,
      confidenceSum: 0,
      confidenceCount: 0,
      lastPractisedDate: null,
    };

    totals.solvedCount += row.solvedCount;
    totals.stuckCount += row.stuckCount;
    totals.sessionCount += row.sessionCount;
    totals.activeSeconds += row.activeSeconds;
    totals.estimatedSeconds += row.estimatedSeconds;
    totals.confidenceSum += row.confidenceSum;
    totals.confidenceCount += row.confidenceCount;

    const localDate = row.localDate as LocalDate;
    if (totals.lastPractisedDate === null || localDate > totals.lastPractisedDate) {
      totals.lastPractisedDate = localDate;
    }

    byTopic.set(row.topic, totals);
  }

  return byTopic;
}

/**
 * Twelve seven-day buckets ending today.
 *
 * Buckets counted back from today rather than calendar weeks, so the newest
 * bucket is always complete-to-now and no week is half-empty because of which
 * day it happens to be. The label is the bucket's first day.
 */
function buildTrend(days: readonly DayRow[], today: LocalDate): TrendPoint[] {
  const points: TrendPoint[] = [];

  for (let week = TREND_WEEKS - 1; week >= 0; week -= 1) {
    const end = previousLocalDate(today, week * 7);
    const start = previousLocalDate(end, 6);
    const range = new Set(localDateRange(start, end));

    const inWeek = days.filter((day) => range.has(day.localDate as LocalDate));
    const solved = sum(inWeek, (day) => day.solvedCount);
    const seconds = sum(inWeek, (day) => day.activeSeconds);

    points.push({
      weekStart: start,
      // Per problem SOLVED here, because the trend is about how long a solve
      // takes — a week of only-stuck sittings has no solve time to report.
      averageMinutesPerProblem: solved > 0 ? Math.round(seconds / solved / 60) : null,
    });
  }

  return points;
}

function buildStuckDistribution(stuckDays: readonly StuckDayRow[]) {
  const byCategory = new Map<string, { category: string; marked: number; reflected: number }>();

  for (const row of stuckDays) {
    const totals = byCategory.get(row.category) ?? {
      category: row.category,
      marked: 0,
      reflected: 0,
    };
    totals.marked += row.markedCount;
    totals.reflected += row.reflectedCount;
    byCategory.set(row.category, totals);
  }

  return [...byCategory.values()].sort(
    (left, right) =>
      right.marked + right.reflected - (left.marked + left.reflected) ||
      left.category.localeCompare(right.category),
  );
}

const sum = <T>(rows: readonly T[], pick: (row: T) => number): number =>
  rows.reduce((total, row) => total + pick(row), 0);
