/**
 * Step A3 · baseline for the prompt after an accepted Submit, as it is today.
 *
 * Inside a live sitting on an ORIGINAL problem, an accepted Submit asks
 * "Mark this sitting solved and stop the timer?" — a prompt, not an auto-stop
 * (SolvedPrompt.tsx explains why). The step-1 inventory found it untested.
 * Pinned here with the flag off and no UI change:
 *
 *   · it appears after an accepted Submit inside a sitting
 *   · "Keep working" dismisses it and the sitting carries on
 *   · dismissing one does not silence the next accepted Submit
 *   · answering it completes the sitting as solved, with the confidence given
 *
 * The local Judge0 contract server echoes stdin, and every case below expects
 * its own input back, so the starter (the reference solution here) is accepted.
 */
import { expect, test, type Page } from '@playwright/test';
import type postgres from 'postgres';
import { CONFIDENCE_LABELS } from '../lib/session/confidence';
import { cleanup, db, deleteProblems, signInAs } from './helpers/auth';

const SLUG = 'a3-submit-original';
let sql: ReturnType<typeof postgres>;
let licenseId: string;
let problemId: string;

test.beforeAll(async () => {
  sql = db();
  await deleteProblems(sql, SLUG);

  const [license] = await sql`
    INSERT INTO content_licenses
      (provenance, license_name, author, independently_created, review_notes)
    VALUES ('quadrantcode-original', 'A3 baseline fixture license', 'Quadrantcode tests', true,
            'Independently authored browser-test fixture.')
    RETURNING id
  `;
  licenseId = String(license!['id']);
  const [problem] = await sql`
    INSERT INTO problems
      (slug, title, source_type, difficulty, estimated_minutes, status, current_version,
       statement, input_format, output_format, constraints_text)
    VALUES (${SLUG}, 'A3 Submit Original', 'original', 'easy', 10, 'published', 1,
            'Return the single supplied integer unchanged.',
            'One signed integer.', 'The same signed integer.', '-100 <= value <= 100')
    RETURNING id
  `;
  problemId = String(problem!['id']);
  const [version] = await sql`
    INSERT INTO problem_versions
      (problem_id, version, status, problem_type, story, statement, input_format,
       output_format, function_contract, constraints, hints, time_limit_ms,
       memory_limit_kb, content_license_id, provenance, reference_validated_at,
       reference_validation_provider, reference_validation_summary, published_at)
    VALUES
      (${problemId}, 1, 'published', 'function',
       'A relay passes one number along exactly as it arrived.',
       'Return the single supplied integer unchanged.',
       'The values array contains exactly one signed integer.',
       'Return that integer.',
       ${JSON.stringify({ functionName: 'solve', parameters: [{ name: 'values', type: 'integer[]', description: 'One integer.' }], returnType: '64-bit integer' })}::jsonb,
       ${JSON.stringify(['values.length = 1'])}::jsonb,
       ${JSON.stringify(['Return values[0].'])}::jsonb,
       1500, 128000, ${licenseId}, 'Independent Quadrantcode E2E fixture.', now(),
       'judge0-e2e-contract', ${JSON.stringify({ languages: ['cpp17'], tests: 2, runtimeVersions: {} })}::jsonb, now())
    RETURNING id
  `;
  const versionId = String(version!['id']);
  const source = 'long long solve(const vector<long long>& values) { return values[0]; }';
  await sql`
    INSERT INTO problem_language_templates
      (problem_version_id, language, display_name, runtime_version, function_signature,
       starter_code, wrapper_template, serialization, reference_solution,
       validation_hash, last_validated_at)
    VALUES
      (${versionId}, 'cpp17', 'C++', 'e2e-runtime',
       'long long solve(const vector<long long>& values)', ${source},
       ${'#include <bits/stdc++.h>\nusing namespace std;\n/*__USER_CODE__*/\nint main(){long long x;cin>>x;cout<<solve(vector<long long>{x});}'},
       ${JSON.stringify({ input: 'One integer.', output: 'One integer.', equality: 'exact_json' })}::jsonb,
       ${source}, 'e2e-validated-hash', now())
  `;
  await sql`
    INSERT INTO test_cases
      (problem_version_id, ordinal, visibility, coverage, input, expected_output, is_performance)
    VALUES
      (${versionId}, 1, 'sample', 'sample', '7', '7', false),
      (${versionId}, 2, 'hidden', 'minimum', '0', '0', false)
  `;
});

test.afterAll(async () => {
  await deleteProblems(sql, SLUG);
  await sql`DELETE FROM content_licenses WHERE id = ${licenseId}`;
  await cleanup(sql);
  await sql.end();
});

const timerOf = (page: Page) => page.getByRole('region', { name: /solve session timer/i });

/** Starts a sitting on the problem page, then opens the editor inside it. */
async function sitting(page: Page) {
  await page.goto(`/problems/${SLUG}`);
  const started = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' && !!response.request().headers()['next-action'],
  );
  await page.getByRole('button', { name: /start solving/i }).click();
  expect((await started).ok()).toBe(true);
  await page.goto(`/problems/${SLUG}/solve`);
  await expect(timerOf(page)).toBeVisible();
}

async function submitAccepted(page: Page) {
  await page.getByRole('button', { name: 'Submit' }).click();
  await expect(page.getByTestId('run-verdict')).toHaveText('Accepted', { timeout: 20_000 });
}

test('AN ACCEPTED SUBMIT ASKS; Keep working dismisses it, and the next one asks again', async ({
  page,
  context,
  baseURL,
}) => {
  await signInAs(context, sql, { email: 'a3-keep-working@e2e.test', baseUrl: baseURL! });
  await sitting(page);

  await submitAccepted(page);
  const prompt = page.getByTestId('solved-prompt');
  await expect(prompt).toBeVisible();
  await expect(prompt).toContainText('Accepted. Mark this sitting solved and stop the timer?');
  await expect(prompt).toContainText('The problem stays marked solved either way.');

  await prompt.getByRole('button', { name: 'Keep working' }).click();
  await expect(prompt).toBeHidden();
  // Not an auto-stop: the sitting is still running.
  await expect(timerOf(page)).toBeVisible();

  // Dismissal is per run, not for the rest of the sitting.
  await submitAccepted(page);
  await expect(page.getByTestId('solved-prompt')).toBeVisible();
});

test('ANSWERING THE PROMPT completes the sitting as solved, with that confidence', async ({
  page,
  context,
  baseURL,
}) => {
  const userId = await signInAs(context, sql, {
    email: 'a3-complete@e2e.test',
    baseUrl: baseURL!,
  });
  await sitting(page);

  await submitAccepted(page);
  const prompt = page.getByTestId('solved-prompt');
  await prompt
    .getByTestId('confidence-picker')
    .getByRole('button', { name: CONFIDENCE_LABELS.high })
    .click();

  // The sitting ends, so the timer bar goes.
  await expect(timerOf(page)).toBeHidden();

  const [session] = await sql`
    SELECT status, confidence FROM solve_sessions
    WHERE user_id = ${userId} AND problem_id = ${problemId}
    ORDER BY started_at DESC LIMIT 1
  `;
  expect(session!['status']).toBe('solved');
  expect(session!['confidence']).toBe('high');

  const [record] = await sql`
    SELECT status FROM user_problems WHERE user_id = ${userId} AND problem_id = ${problemId}
  `;
  expect(record!['status']).toBe('solved');
});
