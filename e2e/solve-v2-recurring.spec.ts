/**
 * C4 · the solve screen's recurring-mistake chip.
 *
 *   · a stored pattern on one of the problem's topics: the chip shows it
 *   · patterns on other topics, with no topic, or seen only once: no chip
 *   · in a blind revision sitting: no chip, and no trace in any payload
 *   · every case: `mistake_patterns` and `mistake_warnings_shown` are exactly
 *     as they were, so the page wrote nothing (no `warningFor`, no rebuild)
 */
import { expect, test, type Page } from '@playwright/test';
import type postgres from 'postgres';
import { TREND_LABELS } from '../lib/mistakes/trends';
import { SOLVE_V2_RECURRING_MARKER } from '../lib/solve-v2/marker';
import { cleanup, db, deleteProblems, signInAs } from './helpers/auth';
import { capturePayload, settle } from './helpers/payload';

const SLUG = 'c4-recurring-alpha';
const TOPIC = 'arrays';
let sql: ReturnType<typeof postgres>;

test.beforeAll(async () => {
  sql = db();
  await deleteProblems(sql, 'c4-recurring-%');
  await problemWithTopic(SLUG, 'C4 Recurring Alpha');
});

test.afterAll(async () => {
  await deleteProblems(sql, 'c4-recurring-%');
  await cleanup(sql);
  await sql.end();
});

async function problemWithTopic(slug: string, title: string): Promise<string> {
  const [row] = await sql`
    INSERT INTO problems (slug, title, source_type, platform, external_url, difficulty, status)
    VALUES (${slug}, ${title}, 'external_link', 'leetcode',
            ${`https://leetcode.com/problems/${slug}/`}, 'easy', 'published')
    RETURNING id
  `;
  const id = String(row!['id']);
  await sql`
    INSERT INTO problem_tags (problem_id, tag_type, tag_value)
    VALUES (${id}, 'topic', ${TOPIC}), (${id}, 'pattern', 'two-pointers')
  `;
  return id;
}

/** One stored pattern, as `rebuildPatterns` would have written it. */
async function seedPattern(
  userId: string,
  pattern: { category: string; topic: string | null; occurrences: number },
) {
  await sql`
    INSERT INTO mistake_patterns (user_id, category, topic, occurrences, recent_count,
                                  earlier_count, trend, first_seen_on, last_seen_on)
    VALUES (${userId}, ${pattern.category}, ${pattern.topic}, ${pattern.occurrences},
            ${pattern.occurrences}, 0, 'worsening', now() - interval '20 days',
            now() - interval '2 days')
  `;
}

/** Both tables the chip must never write, for one user. */
async function writableState(userId: string) {
  return {
    patterns: await sql`SELECT * FROM mistake_patterns WHERE user_id = ${userId} ORDER BY id`,
    warnings:
      await sql`SELECT * FROM mistake_warnings_shown WHERE user_id = ${userId} ORDER BY id`,
  };
}

const chipOf = (page: Page) => page.getByRole('region', { name: 'Recurring for you' });

test('A PATTERN ON THIS TOPIC: the chip shows it, and nothing is written', async ({
  page,
  context,
  baseURL,
}) => {
  const userId = await signInAs(context, sql, {
    email: 'c4-match@e2e.test',
    baseUrl: baseURL!,
  });
  await seedPattern(userId, { category: 'off_by_one', topic: TOPIC, occurrences: 3 });
  const before = await writableState(userId);

  const capture = capturePayload(page);
  await page.goto(`/problems/${SLUG}/solve`);
  await expect(chipOf(page)).toBeVisible();
  await settle(page);
  await capture.stop();

  await expect(chipOf(page)).toContainText('Off by one');
  await expect(chipOf(page)).toContainText(`${TOPIC} · 3 times · ${TREND_LABELS.worsening}`);
  await expect(chipOf(page).getByRole('link', { name: 'All your mistakes' })).toHaveAttribute(
    'href',
    '/mistakes',
  );
  // POSITIVE CONTROL for the blind test's absence check: when the chip renders,
  // the capture does find its marker.
  expect(capture.find(SOLVE_V2_RECURRING_MARKER).length).toBeGreaterThan(0);

  // A reload too: `warningFor` would have inserted on the first load at the latest.
  await page.reload();
  await expect(chipOf(page)).toBeVisible();
  expect(await writableState(userId)).toEqual(before);
  expect(before.patterns).toHaveLength(1);
  expect(before.warnings).toHaveLength(0);
});

test('NO MATCH: other topics, no topic, or a single occurrence show no chip', async ({
  page,
  context,
  baseURL,
}) => {
  const userId = await signInAs(context, sql, {
    email: 'c4-nomatch@e2e.test',
    baseUrl: baseURL!,
  });
  await seedPattern(userId, { category: 'wrong_logic', topic: 'graphs', occurrences: 6 });
  await seedPattern(userId, { category: 'tle', topic: null, occurrences: 5 });
  await seedPattern(userId, { category: 'missed_edge_case', topic: TOPIC, occurrences: 1 });
  const before = await writableState(userId);

  await page.goto(`/problems/${SLUG}/solve`);
  // The screen has rendered for this signed-in user: the history card is there.
  await expect(
    page.getByRole('region', { name: 'Your history on this problem' }),
  ).toBeVisible();
  await expect(chipOf(page)).toHaveCount(0);
  expect(await writableState(userId)).toEqual(before);
});

test('IN A BLIND RETRY: no chip, and no trace of it in any payload', async ({
  page,
  context,
  baseURL,
}) => {
  const email = 'c4-blind@e2e.test';
  const userId = await signInAs(context, sql, { email, baseUrl: baseURL! });
  const slug = 'c4-recurring-blind';
  const problemId = await problemWithTopic(slug, 'C4 Recurring Blind');

  // A matching pattern, so only the blind rule can keep the chip away.
  await seedPattern(userId, { category: 'off_by_one', topic: TOPIC, occurrences: 4 });
  // Solved three days ago, due for revision today.
  await sql`
    INSERT INTO solve_sessions (user_id, problem_id, status, started_at, ended_at,
                                last_heartbeat_at, started_local_date, ended_local_date)
    VALUES (${userId}, ${problemId}, 'solved', now() - interval '3 days',
            now() - interval '3 days' + interval '20 minutes', now() - interval '3 days',
            (now() - interval '3 days')::date, (now() - interval '3 days')::date)
  `;
  await sql`
    INSERT INTO revision_schedule (user_id, problem_id, interval_days, due_local_date)
    SELECT ${userId}, ${problemId}, 3, timezone(u.timezone, now())::date
    FROM users u WHERE u.id = ${userId}
  `;
  const before = await writableState(userId);

  await page.goto('/revision');
  const capture = capturePayload(page);
  await page.getByRole('button', { name: 'Blind retry' }).click();
  await page.waitForURL(`**/problems/${slug}/solve`);
  await expect(page.getByRole('region', { name: /blind retry revision/i })).toBeVisible();
  await settle(page);
  await capture.stop();

  await expect(chipOf(page)).toHaveCount(0);
  expect(capture.find(SOLVE_V2_RECURRING_MARKER).map((response) => response.url)).toEqual([]);
  // POSITIVE CONTROL: this really is the v2 screen, with its strip.
  await expect(page.getByRole('region', { name: /solve session timer/i })).toHaveAttribute(
    'data-solve-v2-strip',
    '',
  );
  expect(await writableState(userId)).toEqual(before);
});
