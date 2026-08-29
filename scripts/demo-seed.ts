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
 * **It prints a session token.** That is the same mechanism `e2e/helpers/auth.ts`
 * uses: insert an `auth_sessions` row and carry its token in the session
 * cookie. It is a development convenience and nothing else — it does not
 * bypass any check, it creates a real session the same way a magic link would.
 */
import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import postgres from 'postgres';

const DEMO_EMAIL = 'demo@traceloop.local';

const PROBLEMS = [
  ['demo-two-sum-style', 'Two Sum', 'easy', 'arrays'],
  ['demo-binary-search-style', 'Binary Search', 'easy', 'binary-search'],
  ['demo-search-rotated-style', 'Search in Rotated Sorted Array', 'medium', 'binary-search'],
  ['demo-coin-change-style', 'Coin Change', 'medium', 'dynamic-programming'],
  ['demo-course-schedule-style', 'Course Schedule', 'medium', 'graphs'],
  ['demo-lru-cache-style', 'LRU Cache', 'medium', 'design'],
  ['demo-median-two-sorted-style', 'Median of Two Sorted Arrays', 'hard', 'binary-search'],
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

  const sql = postgres(url, { max: 1, onnotice: () => {} });

  /*
   * Start clean — the user AND the problems.
   *
   * The problems matter more than they look: they live in the catalog the e2e
   * suite walks, and leaving them behind breaks tests that have nothing to do
   * with this script.
   */
  await sql.begin(async (tx) => {
    await tx`SELECT set_config('traceloop.purging', 'on', true)`;
    await tx`DELETE FROM users WHERE email = ${DEMO_EMAIL}`;
    await tx`DELETE FROM problems WHERE slug LIKE 'demo-%'`;
  });

  if (process.argv.includes('--clean')) {
    console.log(JSON.stringify({ event: 'demo.cleaned' }));
    await sql.end();
    return;
  }

  const [user] = await sql`
    INSERT INTO users (email, role, timezone, email_verified_at)
    VALUES (${DEMO_EMAIL}, 'admin', 'Asia/Kolkata', now())
    RETURNING id
  `;
  const userId = String(user!['id']);

  await sql`
    INSERT INTO user_profiles (user_id, display_name, target_role, bio)
    VALUES (${userId}, 'Demo User', 'sde_1',
            'Working through binary search and DP before interviews.')
    ON CONFLICT (user_id) DO UPDATE SET display_name = excluded.display_name
  `;

  await sql`
    INSERT INTO daily_goals (user_id, target_problems, effective_from)
    VALUES (${userId}, 2, current_date - 60)
    ON CONFLICT DO NOTHING
  `;

  const problemIds: string[] = [];

  for (const [slug, title, difficulty, topic] of PROBLEMS) {
    const [problem] = await sql`
      INSERT INTO problems (slug, title, source_type, platform, external_url, difficulty, status)
      VALUES (${slug}, ${title}, 'external_link', 'leetcode',
              ${`https://leetcode.com/problems/${slug}/`}, ${difficulty}, 'published')
      ON CONFLICT (slug) DO UPDATE SET title = excluded.title
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
   * Sessions across the last month, so the streak, the heatmap and the trend
   * windows all have something to work with. Every one is finished — a live
   * session would put the timer bar into a running state on every screenshot.
   */
  const outcomes: { daysAgo: number; problem: number; solved: boolean; minutes: number }[] = [
    { daysAgo: 26, problem: 0, solved: true, minutes: 14 },
    { daysAgo: 24, problem: 1, solved: true, minutes: 22 },
    { daysAgo: 21, problem: 2, solved: false, minutes: 41 },
    { daysAgo: 19, problem: 2, solved: true, minutes: 33 },
    { daysAgo: 16, problem: 3, solved: false, minutes: 47 },
    { daysAgo: 13, problem: 4, solved: true, minutes: 28 },
    { daysAgo: 9, problem: 3, solved: true, minutes: 35 },
    { daysAgo: 6, problem: 5, solved: true, minutes: 24 },
    { daysAgo: 4, problem: 6, solved: false, minutes: 52 },
    { daysAgo: 2, problem: 1, solved: true, minutes: 11 },
    { daysAgo: 1, problem: 2, solved: true, minutes: 18 },
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
