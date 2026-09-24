/**
 * F4.7 · the public profile in a browser.
 *
 * "With the profile ON, code/notes/mistakes/reflections are absent from every
 * public payload (verify the network response, not the render)" and "OG image
 * renders correctly at all three target sizes" — both need a real server, so
 * they live here. The positive control finds the display name in the same
 * capture, so a "not found" cannot mean the capture read nothing.
 */
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import type postgres from 'postgres';
import { cleanup, db, deleteProblems, signInAs } from './helpers/auth';
import { capturePayload, settle, triggerPrefetches } from './helpers/payload';

let sql: ReturnType<typeof postgres>;

const tag = randomUUID().slice(0, 8);
const OWNER = 'public-owner@e2e.test';
const HANDLE = `owner-${tag}`;
const NAME = `Owner ${tag}`;
const SECRETS = {
  code: `SECRETCODE_${tag}`,
  approach: `SECRETAPPROACH_${tag}`,
  stuck: `SECRETSTUCK_${tag}`,
  bio: `SECRETBIO_${tag}`,
};

test.beforeAll(() => {
  sql = db();
});

test.afterAll(async () => {
  await deleteProblems(sql, 'pubprof-%');
  await cleanup(sql);
  await sql.end();
});

/** An owner with a public profile, one solve, and private traces on it. */
async function seedPublicOwner(enabled: boolean) {
  const [user] = await sql`SELECT id FROM users WHERE email = ${OWNER}`;
  const userId = String(user!.id);

  await sql`
    INSERT INTO user_profiles (user_id, display_name, bio, handle, public_profile_enabled)
    VALUES (${userId}, ${NAME}, ${SECRETS.bio}, ${HANDLE}, ${enabled})
    ON CONFLICT (user_id) DO UPDATE
      SET display_name = excluded.display_name, bio = excluded.bio,
          handle = excluded.handle, public_profile_enabled = excluded.public_profile_enabled
  `;

  const [problem] = await sql`
    INSERT INTO problems (slug, title, source_type, platform, external_url, difficulty, status)
    VALUES (${`pubprof-${tag}`}, 'Public fixture', 'external_link', 'leetcode',
            'https://leetcode.com/problems/two-sum/', 'easy', 'published')
    RETURNING id
  `;
  const problemId = String(problem!.id);
  await sql`
    INSERT INTO problem_tags (problem_id, tag_type, tag_value) VALUES (${problemId}, 'topic', 'arrays-hashing')
  `;
  const [session] = await sql`
    INSERT INTO solve_sessions (user_id, problem_id, status, started_at, ended_at,
                                last_heartbeat_at, started_local_date, ended_local_date)
    VALUES (${userId}, ${problemId}, 'solved', now() - interval '1 hour', now() - interval '40 minutes',
            now() - interval '1 hour', (now() - interval '1 hour')::date, (now() - interval '40 minutes')::date)
    RETURNING id
  `;
  const sessionId = String(session!.id);
  await sql`
    INSERT INTO user_problems (user_id, problem_id, status, total_attempts)
    VALUES (${userId}, ${problemId}, 'solved', 1)
    ON CONFLICT DO NOTHING
  `;
  await sql`
    INSERT INTO code_snapshots (session_id, user_id, sequence, language, is_full, content,
                                source_bytes, trigger, occurred_at)
    VALUES (${sessionId}, ${userId}, 0, 'python3', true, ${`print("${SECRETS.code}")`}, 30,
            'run_attempt', now() - interval '50 minutes')
  `;
  await sql`
    INSERT INTO stuck_points (session_id, category, elapsed_seconds, note, source)
    VALUES (${sessionId}, 'approach', 120, ${SECRETS.stuck}, 'user')
  `;
  await sql`INSERT INTO reflections (session_id, approach) VALUES (${sessionId}, ${SECRETS.approach})`;
}

/** Width and height from a PNG's IHDR chunk — the image's real dimensions. */
function pngSize(buffer: Buffer): { width: number; height: number } {
  expect(buffer.subarray(1, 4).toString('ascii')).toBe('PNG');
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

test.beforeEach(async ({ context, baseURL }) => {
  await deleteProblems(sql, 'pubprof-%');
  await cleanup(sql);
  await signInAs(context, sql, { email: OWNER, baseUrl: baseURL! });
});

test('a new account is not public: the toggle is off and no page resolves', async ({
  page,
}) => {
  await page.goto('/settings/profile');
  await expect(page.getByRole('checkbox', { name: /public profile/i })).not.toBeChecked();

  const response = await page.goto(`/u/${HANDLE}`);
  expect(response?.status()).toBe(404);
});

test('WITH THE PROFILE ON, NOTHING PRIVATE IS IN ANY PUBLIC PAYLOAD', async ({
  browser,
  baseURL,
}) => {
  await seedPublicOwner(true);

  // A signed-out visitor — the audience the page is for.
  const visitor = await browser.newContext();
  const page = await visitor.newPage();
  const capture = capturePayload(page);
  const response = await page.goto(`${baseURL}/u/${HANDLE}`);
  expect(response?.status()).toBe(200);
  await triggerPrefetches(page);
  await settle(page);
  await capture.stop();

  // Positive control: the capture does read the page.
  expect(capture.find(NAME).length).toBeGreaterThan(0);
  expect(capture.find('arrays-hashing').length).toBeGreaterThan(0);

  for (const [what, secret] of Object.entries(SECRETS)) {
    expect(capture.find(secret), what).toEqual([]);
  }
  expect(capture.find(OWNER)).toEqual([]);
  await visitor.close();
});

test('THE SHARE CARD RENDERS AT ALL THREE SIZES', async ({ request }) => {
  await seedPublicOwner(true);

  const expected = {
    linkedin: { width: 1200, height: 627 },
    x: { width: 1600, height: 900 },
    whatsapp: { width: 1080, height: 1080 },
  };
  for (const [format, size] of Object.entries(expected)) {
    const response = await request.get(`/u/${HANDLE}/card/${format}`);
    expect(response.status(), format).toBe(200);
    expect(response.headers()['content-type'], format).toContain('image/png');
    expect(pngSize(await response.body()), format).toEqual(size);
  }

  expect((await request.get(`/u/${HANDLE}/card/instagram`)).status()).toBe(404);
});

test('switched off, the page and every card are the same 404 as a missing handle', async ({
  request,
}) => {
  await seedPublicOwner(false);
  expect((await request.get(`/u/${HANDLE}`)).status()).toBe(404);
  expect((await request.get(`/u/${HANDLE}/card/linkedin`)).status()).toBe(404);
  expect((await request.get(`/u/no-such-${tag}`)).status()).toBe(404);
});
