/**
 * The catalog grouped by topic: the default view of /problems.
 *
 * One query answers the whole page. A window over `problem_tags ⋈ problems`
 * numbers each topic's problems easiest first, then by number, and counts
 * them by difficulty; the outer query keeps the first few of each. At the
 * catalog's size (thousands of problems, tens of thousands of tag rows) that is
 * one pass, against one round trip per topic for the obvious loop.
 *
 * A problem with several topic tags appears under each of them. That is the
 * point of a topic view, and its fixed number is how a reader recognises it
 * the second time.
 */
import { and, eq, sql } from 'drizzle-orm';
import type { Database } from '@/server/db';
import { userProblems } from '@/server/db/schema';
import { type TopicProblem, type TopicSection, compareTopics } from '@/lib/problems/topics';

export type { TopicProblem, TopicSection };
import { originalsVisible } from './queries';

type Row = Record<string, unknown> & {
  topic: string;
  id: string;
  number: number;
  slug: string;
  title: string;
  difficulty: TopicProblem['difficulty'];
  source_type: TopicProblem['sourceType'];
  platform: string | null;
  total: number;
  easy: number;
  medium: number;
  hard: number;
};

/**
 * Same visibility as the list: published only, and originals only while
 * `FEATURE_ORIGINAL_PROBLEMS` is on. A topic view that ignored the flag would
 * be a fourth route into the catalog that the gate does not cover.
 */
function visibility() {
  return originalsVisible()
    ? sql`p.status = 'published'`
    : sql`p.status = 'published' AND p.source_type = 'external_link'`;
}

export async function listTopicSections(
  db: Database,
  options: { userId: string | null; perTopic?: number },
): Promise<TopicSection[]> {
  const perTopic = options.perTopic ?? 5;

  const result = await db.execute<Row>(sql`
    WITH tagged AS (
      SELECT
        t.tag_value AS topic,
        p.id, p.number, p.slug, p.title, p.difficulty, p.source_type, p.platform,
        row_number() OVER (PARTITION BY t.tag_value ORDER BY p.difficulty, p.number) AS rn,
        count(*) OVER (PARTITION BY t.tag_value)::int AS total,
        (count(*) FILTER (WHERE p.difficulty = 'easy') OVER (PARTITION BY t.tag_value))::int AS easy,
        (count(*) FILTER (WHERE p.difficulty = 'medium') OVER (PARTITION BY t.tag_value))::int AS medium,
        (count(*) FILTER (WHERE p.difficulty = 'hard') OVER (PARTITION BY t.tag_value))::int AS hard
      FROM problem_tags t
      JOIN problems p ON p.id = t.problem_id
      WHERE t.tag_type = 'topic' AND ${visibility()}
    )
    SELECT topic, id, number, slug, title, difficulty, source_type, platform, total, easy, medium, hard
    FROM tagged
    WHERE rn <= ${perTopic}
    ORDER BY topic, rn
  `);
  const rows = [...result];

  const statusById = new Map<string, string>();
  const ids = [...new Set(rows.map((row) => row.id))];
  if (options.userId && ids.length > 0) {
    const owned = await db
      .select({ problemId: userProblems.problemId, status: userProblems.status })
      .from(userProblems)
      .where(
        and(eq(userProblems.userId, options.userId), sql`${userProblems.problemId} IN ${ids}`),
      );
    for (const row of owned) statusById.set(row.problemId, row.status);
  }

  const sections = new Map<string, TopicSection>();
  for (const row of rows) {
    let section = sections.get(row.topic);
    if (!section) {
      section = {
        topic: row.topic,
        total: Number(row.total),
        easy: Number(row.easy),
        medium: Number(row.medium),
        hard: Number(row.hard),
        problems: [],
      };
      sections.set(row.topic, section);
    }
    section.problems.push({
      id: row.id,
      number: Number(row.number),
      slug: row.slug,
      title: row.title,
      difficulty: row.difficulty,
      sourceType: row.source_type,
      platform: row.platform,
      userStatus: statusById.get(row.id) ?? null,
    });
  }

  return [...sections.values()].sort(compareTopics);
}

/**
 * Every topic with at least one visible problem, for the catalog's topic
 * filter, in the topic view's order.
 */
export async function listCatalogTopics(
  db: Database,
): Promise<Array<{ topic: string; total: number }>> {
  const result = await db.execute<{ topic: string; total: number }>(sql`
    SELECT t.tag_value AS topic, count(*)::int AS total
    FROM problem_tags t
    JOIN problems p ON p.id = t.problem_id
    WHERE t.tag_type = 'topic' AND ${visibility()}
    GROUP BY t.tag_value
  `);
  return [...result]
    .map((row) => ({ topic: row.topic, total: Number(row.total) }))
    .sort(compareTopics);
}
