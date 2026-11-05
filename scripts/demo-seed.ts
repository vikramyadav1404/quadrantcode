/**
 * Populate a database with one user's plausible history, for a walkthrough.
 *
 *   npm run demo:seed
 *
 * ## Why this exists
 *
 * Nobody can sign in — `RESEND_API_KEY` is blocked, so the magic link is never
 * delivered. Every page past `/login` is therefore unreachable by hand, and a
 * screenshot of an empty dashboard shows nothing about whether the features
 * work.
 *
 * This seeds a signed-in-able user with a month of solves, reflections,
 * snapshots and a confirmed stuck point, so the pages have something true to
 * render. It writes through the same tables the app writes through — no
 * shortcuts, no fixture-only columns.
 *
 * ## It shares a database with the e2e suite, so it cleans up after itself
 *
 * There is only one Postgres here — the embedded test instance. Problems left
 * behind by this script therefore sit in the catalog the browser tests walk,
 * and `e2e/keyboard.spec.ts` counts tab stops: seven extra rows pushed its own
 * fixtures out of the traversal budget and failed a test that had nothing to do
 * with what changed.
 *
 * Every slug here is prefixed `demo-`, and the script deletes that whole prefix
 * before seeding. `npm run demo:seed -- --clean` removes them without
 * re-seeding, which is what to run before a full e2e pass.
 *
 * ## Running it against a deployment
 *
 * It was written for the local instance and now also seeds the production
 * database, so the walkthrough link is not seven empty pages. Two consequences
 * that do not apply locally:
 *
 * - **The printed session token is a live credential**, not a development
 *   convenience. It is a real `auth_sessions` row — the same mechanism
 *   `e2e/helpers/auth.ts` uses — valid for thirty days against whatever
 *   database it was written to. It bypasses no check; it is exactly the session
 *   a magic link would have produced. Anyone holding it is signed in as the
 *   demo user until the row is deleted.
 * - **The demo user is `role: 'user'` deliberately.** `app/admin` and
 *   `app/api/admin` are gated on role rank, and nothing in the walkthrough
 *   needs them. An admin demo account plus a printed token would put native
 *   review and problem CRUD behind a string in a terminal transcript.
 *
 * `--clean` removes the user, the sessions and the token together, so the whole
 * seed is reversible. That depends on the database's `session_events` trigger
 * reading `quadrantcode.purging`; `npm run schema:check` confirms it does.
 */
import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { DEMO_EMAIL } from '@/lib/auth/demo';
import { schema } from '@/server/db/client';
import { localDateFor, recomputeStreak } from '@/server/services/streak';
import { assertNotProductionDatabase } from '@/lib/db/production-guard';

/** The demo user's timezone, and therefore the one its day boundary uses. */
const DEMO_TIMEZONE = 'Asia/Kolkata';

/*
 * The fifth field is the real LeetCode slug, and it is separate from ours on
 * purpose: the first field has to keep the `demo-` prefix, because that prefix
 * is what the cleanup deletes on.
 *
 * Earlier this built the URL from the demo slug, which produced links like
 * `/problems/demo-two-sum-style/` — every one a 404. On a walkthrough
 * deployment that is a dead link under a real problem title.
 *
 * Title, difficulty, topic and a link is metadata, which is what C1 permits;
 * no statement, examples or tests are copied, and the CHECK constraint
 * `problems_external_link_no_statement` is the backstop.
 *
 * Verified against LeetCode's own catalogue (`/api/problems/all/`, 4,055
 * slugs) rather than from memory — a plain fetch of each URL returns 403 for
 * real and invented slugs alike, so it cannot tell them apart.
 */
const PROBLEMS = [
  ['demo-two-sum-style', 'Two Sum', 'easy', 'arrays', 'two-sum'],
  ['demo-binary-search-style', 'Binary Search', 'easy', 'binary-search', 'binary-search'],
  [
    'demo-search-rotated-style',
    'Search in Rotated Sorted Array',
    'medium',
    'binary-search',
    'search-in-rotated-sorted-array',
  ],
  ['demo-coin-change-style', 'Coin Change', 'medium', 'dynamic-programming', 'coin-change'],
  ['demo-course-schedule-style', 'Course Schedule', 'medium', 'graphs', 'course-schedule'],
  ['demo-lru-cache-style', 'LRU Cache', 'medium', 'design', 'lru-cache'],
  [
    'demo-median-two-sorted-style',
    'Median of Two Sorted Arrays',
    'hard',
    'binary-search',
    'median-of-two-sorted-arrays',
  ],
] as const;

/** A solution that gets its binary-search bounds wrong, then right. */
const VERSIONS = [
  [
    'class Solution:',
    '    def search(self, nums: list[int], target: int) -> int:',
    '        lo, hi = 0, len(nums)',
    '        while lo < hi:',
    '            mid = (lo + hi) // 2',
    '            if nums[mid] == target:',
    '                return mid',
    '            if nums[mid] < target:',
    '                lo = mid',
    '            else:',
    '                hi = mid',
    '        return -1',
    '',
  ].join('\n'),
  [
    'class Solution:',
    '    def search(self, nums: list[int], target: int) -> int:',
    '        lo, hi = 0, len(nums) - 1',
    '        while lo < hi:',
    '            mid = (lo + hi) // 2',
    '            if nums[mid] == target:',
    '                return mid',
    '            if nums[mid] < target:',
    '                lo = mid',
    '            else:',
    '                hi = mid',
    '        return -1',
    '',
  ].join('\n'),
  [
    'class Solution:',
    '    def search(self, nums: list[int], target: int) -> int:',
    '        lo, hi = 0, len(nums) - 1',
    '        while lo <= hi:',
    '            mid = (lo + hi) // 2',
    '            if nums[mid] == target:',
    '                return mid',
    '            if nums[mid] < target:',
    '                lo = mid + 1',
    '            else:',
    '                hi = mid - 1',
    '        return -1',
    '',
  ].join('\n'),
];

async function main(): Promise<void> {
  const url = process.env['DATABASE_URL'];
  if (!url) throw new Error('DATABASE_URL is not set');

  /*
   * Never production, and no override (#27). The walkthrough rows this script
   * writes are what left seven `demo-*` problems in production's catalog.
   * Checked before the target is printed below, so the production host is not.
   */
  assertNotProductionDatabase(url, 'DATABASE_URL (scripts/demo-seed.ts)');

  /*
   * Say which database this is, before touching it.
   *
   * `.env` points DATABASE_URL at the local instance, and dotenv does not
   * override a variable already set in the shell — so seeding a deployment
   * means exporting it first, and forgetting to is silent. The restore drill
   * wrote its marker to localhost:55432 exactly this way and produced a
   * transcript that read as if it had worked.
   */
  const target = new URL(url);
  console.log(
    JSON.stringify({ event: 'demo.target', database: `${target.host}${target.pathname}` }),
  );

  const sql = postgres(url, { max: 1, onnotice: () => {} });

  /*
   * Start clean — the user AND the problems.
   *
   * The problems matter more than they look: they live in the catalog the e2e
   * suite walks, and leaving them behind breaks tests that have nothing to do
   * with this script.
   */
  await sql.begin(async (tx) => {
    await tx`SELECT set_config('quadrantcode.purging', 'on', true)`;
    await tx`DELETE FROM users WHERE email = ${DEMO_EMAIL}`;
    await tx`DELETE FROM problems WHERE slug LIKE 'demo-%'`;
  });

  if (process.argv.includes('--clean')) {
    console.log(JSON.stringify({ event: 'demo.cleaned' }));
    await sql.end();
    return;
  }

  // `user`, not `admin`. See the note at the top: this account's session token
  // is printed, and admin would carry /admin and /api/admin with it.
  const [user] = await sql`
    INSERT INTO users (email, role, timezone, email_verified_at)
    VALUES (${DEMO_EMAIL}, 'user', ${DEMO_TIMEZONE}, now())
    RETURNING id
  `;
  const userId = String(user!['id']);

  // The display name is the one that shows in the app shell, so it is where a
  // reader decides whether they are looking at a real account.
  await sql`
    INSERT INTO user_profiles (user_id, display_name, target_role, bio)
    VALUES (${userId}, 'Demo Account', 'sde_1',
            'Seeded sample data for the walkthrough — not a real user.')
    ON CONFLICT (user_id) DO UPDATE
      SET display_name = excluded.display_name, bio = excluded.bio
  `;

  await sql`
    INSERT INTO daily_goals (user_id, target_problems, effective_from)
    VALUES (${userId}, 2, current_date - 60)
    ON CONFLICT DO NOTHING
  `;

  const problemIds: string[] = [];

  for (const [slug, title, difficulty, topic, externalSlug] of PROBLEMS) {
    const [problem] = await sql`
      INSERT INTO problems (slug, title, source_type, platform, external_url, difficulty, status)
      VALUES (${slug}, ${title}, 'external_link', 'leetcode',
              ${`https://leetcode.com/problems/${externalSlug}/`}, ${difficulty}, 'published')
      ON CONFLICT (slug) DO UPDATE SET title = excluded.title, external_url = excluded.external_url
      RETURNING id
    `;
    const problemId = String(problem!['id']);
    problemIds.push(problemId);

    await sql`
      INSERT INTO problem_tags (problem_id, tag_type, tag_value)
      VALUES (${problemId}, 'topic', ${topic})
      ON CONFLICT DO NOTHING
    `;
  }

  /*
   * Sessions across the last month. Every one is finished — a live session
   * would put the timer bar into a running state on every screenshot.
   *
   * ## Why the recent days come in pairs
   *
   * A day counts toward the streak when `solvedCount >= targetProblems`
   * (`server/services/streak/rules.ts`), and the goal seeded above is **2**.
   * The first version of this array gave every day at most one solve on eleven
   * distinct dates, so **no day could ever complete** and the dashboard showed
   * `CURRENT STREAK 0` — on a demo account whose entire purpose is not looking
   * empty. It was not a streak bug; the fixture could not satisfy the rule it
   * was being measured against.
   *
   * Days 0–6 therefore carry two solves each, which is a seven-day streak
   * ending **today**. Ending yesterday would render 0 just as convincingly.
   *
   * The extra stuck sittings on days 2 and 4 are deliberate: they give the
   * mistake panel something to say without touching `solvedCount`, so the
   * streak survives them. That is also what real practice looks like.
   */
  const outcomes: { daysAgo: number; problem: number; solved: boolean; minutes: number }[] = [
    // The live streak — two solves a day, today included.
    { daysAgo: 0, problem: 1, solved: true, minutes: 12 },
    { daysAgo: 0, problem: 5, solved: true, minutes: 27 },
    { daysAgo: 1, problem: 2, solved: true, minutes: 18 },
    { daysAgo: 1, problem: 0, solved: true, minutes: 9 },
    { daysAgo: 2, problem: 3, solved: true, minutes: 31 },
    { daysAgo: 2, problem: 1, solved: true, minutes: 15 },
    { daysAgo: 2, problem: 6, solved: false, minutes: 44 },
    { daysAgo: 3, problem: 4, solved: true, minutes: 26 },
    { daysAgo: 3, problem: 2, solved: true, minutes: 20 },
    { daysAgo: 4, problem: 0, solved: true, minutes: 11 },
    { daysAgo: 4, problem: 3, solved: true, minutes: 38 },
    { daysAgo: 4, problem: 2, solved: false, minutes: 49 },
    { daysAgo: 5, problem: 5, solved: true, minutes: 23 },
    { daysAgo: 5, problem: 1, solved: true, minutes: 14 },
    { daysAgo: 6, problem: 2, solved: true, minutes: 29 },
    { daysAgo: 6, problem: 4, solved: true, minutes: 21 },

    // Earlier weeks — partial days, which the heatmap renders differently.
    { daysAgo: 9, problem: 3, solved: true, minutes: 35 },
    { daysAgo: 12, problem: 6, solved: false, minutes: 52 },
    { daysAgo: 16, problem: 3, solved: false, minutes: 47 },
    { daysAgo: 19, problem: 2, solved: true, minutes: 33 },
    { daysAgo: 21, problem: 2, solved: false, minutes: 41 },
    { daysAgo: 24, problem: 1, solved: true, minutes: 22 },
    { daysAgo: 26, problem: 0, solved: true, minutes: 14 },
  ];

  let timelineSessionId = '';

  for (const [index, outcome] of outcomes.entries()) {
    const problemId = problemIds[outcome.problem]!;

    const [session] = await sql`
      INSERT INTO solve_sessions
        (user_id, problem_id, status, confidence, started_at, ended_at,
         started_local_date, ended_local_date)
      VALUES (
        ${userId}, ${problemId},
        ${outcome.solved ? 'solved' : 'stuck'},
        ${outcome.solved ? (outcome.minutes < 20 ? 'high' : 'medium') : 'low'},
        now() - (${outcome.daysAgo} || ' days')::interval,
        now() - (${outcome.daysAgo} || ' days')::interval + (${outcome.minutes} || ' minutes')::interval,
        (now() - (${outcome.daysAgo} || ' days')::interval)::date,
        (now() - (${outcome.daysAgo} || ' days')::interval)::date
      )
      RETURNING id
    `;
    const sessionId = String(session!['id']);

    /*
     * `daily_sessions` counts problems, not seconds — it feeds the streak and
     * the heatmap, both of which ask "did you hit your goal that day". The
     * duration lives on the session itself.
     */
    await sql`
      INSERT INTO daily_sessions (user_id, local_date, target_count, solved_count, completed)
      VALUES (${userId}, (now() - (${outcome.daysAgo} || ' days')::interval)::date,
              2, ${outcome.solved ? 1 : 0}, false)
      ON CONFLICT (user_id, local_date) DO UPDATE
        SET solved_count = daily_sessions.solved_count + excluded.solved_count,
            completed = (daily_sessions.solved_count + excluded.solved_count) >= 2
    `;

    await sql`
      INSERT INTO session_events (session_id, type, occurred_at)
      VALUES (${sessionId}, 'session_started',
              now() - (${outcome.daysAgo} || ' days')::interval)
    `;

    // A reflection on the ones that went badly — the input to mistake memory.
    if (!outcome.solved || index % 3 === 0) {
      const [reflection] = await sql`
        INSERT INTO reflections (session_id, approach, created_at)
        VALUES (${sessionId}, 'Two pointers, then binary search on the answer.',
                now() - (${outcome.daysAgo} || ' days')::interval)
        RETURNING id
      `;

      await sql`
        INSERT INTO reflection_mistakes (reflection_id, category)
        VALUES (${String(reflection!['id'])},
                ${outcome.problem === 3 ? 'wrong_data_structure' : 'off_by_one'})
        ON CONFLICT DO NOTHING
      `;
    }

    // One session gets the full treatment, so /sessions/[id] has a real story.
    if (outcome.daysAgo === 21) {
      timelineSessionId = sessionId;

      for (const [step, source] of VERSIONS.entries()) {
        const at = sql`now() - (${outcome.daysAgo} || ' days')::interval + (${step * 8 + 3} || ' minutes')::interval`;

        await sql`
          INSERT INTO code_snapshots
            (session_id, user_id, sequence, language, is_full, content, source_bytes,
             trigger, occurred_at)
          VALUES (${sessionId}, ${userId}, ${step}, 'python3', true, ${source},
                  ${Buffer.byteLength(source, 'utf8')}, 'run_attempt', ${at})
        `;

        await sql`
          INSERT INTO session_events (session_id, type, occurred_at)
          VALUES (${sessionId}, 'code_snapshot', ${at})
        `;
        await sql`
          INSERT INTO session_events (session_id, type, occurred_at)
          VALUES (${sessionId}, 'run_attempted', ${at})
        `;

        const [job] = await sql`
          INSERT INTO execution_jobs
            (user_id, problem_id, session_id, language, status, source, finished_at)
          VALUES (${userId}, ${problemId}, ${sessionId}, 'python3', 'completed', ${source}, now())
          RETURNING id
        `;

        await sql`
          INSERT INTO run_attempts
            (job_id, user_id, problem_id, session_id, language, verdict, runtime_ms,
             memory_kb, stdout, created_at)
          VALUES (${String(job!['id'])}, ${userId}, ${problemId}, ${sessionId}, 'python3',
                  ${step === VERSIONS.length - 1 ? 'accepted' : 'wrong_answer'},
                  ${40 + step * 12}, ${3200 + step * 180},
                  ${step === VERSIONS.length - 1 ? 'ok' : '(not executed) echo of stdin:\n[4,5,6,7,0,1,2] 0'},
                  ${at})
        `;
      }

      // A stuck point the user confirmed — so the panel shows a real answer.
      await sql`
        INSERT INTO stuck_points
          (session_id, category, elapsed_seconds, source, status, confidence,
           line_start, line_end, started_seconds, ended_seconds, evidence, note)
        VALUES (${sessionId}, 'implementation', 900, 'user', 'confirmed', 'user_marked',
                null, null, null, null, '[]'::jsonb,
                'Kept getting the loop bounds wrong.')
      `;
    }
  }

  // Revision schedule, so /revision has something due today.
  const LADDER_DAYS = [1, 3, 7, 14];

  for (const [index, problemId] of problemIds.slice(0, 4).entries()) {
    await sql`
      INSERT INTO revision_schedule
        (user_id, problem_id, interval_days, ladder_index, due_local_date)
      VALUES (${userId}, ${problemId}, ${LADDER_DAYS[index] ?? 1},
              ${index}, (now() - (${index} || ' days')::interval)::date)
      ON CONFLICT DO NOTHING
    `;
  }

  /*
   * Compute the streak with the real engine, not by writing a number.
   *
   * `user_streaks` is what the dashboard reads
   * (`server/services/analytics/dashboard.ts` → `streak?.currentStreak ?? 0`),
   * and nothing had ever written it here — so the headline read 0 no matter
   * what the sessions said. Asserting a streak directly would also mean
   * restating a rule that already exists in one place, and a fixture that
   * disagrees with `evaluateDayCompletion` is worse than no fixture.
   *
   * `recomputeStreak` is importable from a plain script because it takes
   * `Database` as a TYPE-only import; the schema it pulls in at runtime has no
   * `server-only` guard. Drizzle wraps the connection this script already
   * opened rather than calling `getDb()`, so the streak is computed against
   * exactly the database whose host was printed above — a second pool resolved
   * from the environment could differ from the one just written to.
   */
  const db = drizzle(sql, { schema, casing: 'snake_case' });
  const streak = await recomputeStreak(db, userId, localDateFor(new Date(), DEMO_TIMEZONE));

  const sessionToken = randomBytes(32).toString('hex');
  await sql`
    INSERT INTO auth_sessions (session_token, user_id, expires)
    VALUES (${sessionToken}, ${userId}, now() + interval '30 days')
  `;

  console.log(
    JSON.stringify(
      {
        event: 'demo.seeded',
        email: DEMO_EMAIL,
        userId,
        sessions: outcomes.length,
        problems: PROBLEMS.length,
        // Printed because it is the thing most likely to be silently zero, and
        // a zero here is the difference between a demo and an empty page.
        currentStreak: streak.currentStreak,
        longestStreak: streak.longestStreak,
        timelineSessionId,
        sessionToken,
      },
      null,
      2,
    ),
  );

  await sql.end();
}

void main();
