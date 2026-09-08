import { expect, test } from '@playwright/test';
import type postgres from 'postgres';
import { cleanup, db, deleteProblems, signInAs } from './helpers/auth';

const SLUG = 'e2e-native-signal-count';
const COMPANY_SLUG = 'e2e-native-company';
const PAPER_SLUG = 'e2e-native-pattern-mock';
const HIDDEN_SENTINEL = '9001';
let sql: ReturnType<typeof postgres>;
let licenseId = '';

test.beforeAll(async () => {
  sql = db();
  await sql`DELETE FROM assessment_papers WHERE slug = ${PAPER_SLUG}`;
  await deleteProblems(sql, SLUG);
  await sql`DELETE FROM companies WHERE slug = ${COMPANY_SLUG}`;

  const [license] = await sql`
    INSERT INTO content_licenses
      (provenance, license_name, author, independently_created, review_notes)
    VALUES
      ('quadrantcode-original', 'E2E native content license', 'Quadrantcode tests', true,
       'Independently authored browser-test fixture.')
    RETURNING id
  `;
  licenseId = String(license!.id);
  const [problem] = await sql`
    INSERT INTO problems
      (slug, title, source_type, difficulty, estimated_minutes, status, current_version,
       statement, input_format, output_format, constraints_text)
    VALUES
      (${SLUG}, 'Native Signal Count', 'original', 'easy', 20, 'published', 1,
       'Return the supplied integer signal without changing its value.',
       'One signed integer.', 'The same signed integer.', '-10000 <= value <= 10000')
    RETURNING id
  `;
  const problemId = String(problem!.id);
  const [version] = await sql`
    INSERT INTO problem_versions
      (problem_id, version, status, problem_type, story, statement, input_format,
       output_format, function_contract, constraints, hints, time_limit_ms,
       memory_limit_kb, content_license_id, provenance, reference_validated_at,
       reference_validation_provider, reference_validation_summary, published_at)
    VALUES
      (${problemId}, 1, 'published', 'function',
       'A signal desk needs one integer relayed exactly as it arrived for a deterministic check.',
       'Implement solve so it returns the single supplied integer without changing or discarding it.',
       'The values array contains exactly one signed integer.',
       'Return that signed integer as a 64-bit value.',
       ${JSON.stringify({ functionName: 'solve', parameters: [{ name: 'values', type: 'integer[]', description: 'Exactly one signed integer.' }], returnType: '64-bit integer' })}::jsonb,
       ${JSON.stringify(['values.length = 1', '-10000 <= values[0] <= 10000', 'The answer fits a signed 64-bit integer.'])}::jsonb,
       ${JSON.stringify(['Read the only array element.', 'Return it directly without transformation.'])}::jsonb,
       1500, 128000, ${licenseId}, 'Independent Quadrantcode E2E fixture.', now(),
       'judge0-e2e-contract', ${JSON.stringify({ languages: ['c11', 'cpp17', 'java', 'python3', 'javascript'], tests: 6, runtimeVersions: {} })}::jsonb, now())
    RETURNING id
  `;
  const versionId = String(version!.id);

  await sql`
    INSERT INTO problem_examples (problem_version_id, ordinal, input, output, explanation)
    VALUES
      (${versionId}, 1, '7', '7', 'The only signal is seven, so returning it produces the exact value seven.'),
      (${versionId}, 2, '-3', '-3', 'The negative signal is returned unchanged, so the exact result is negative three.')
  `;
  await sql`
    INSERT INTO editorials
      (problem_version_id, overview, brute_force_approach, optimal_approach,
       correctness_proof, time_complexity, space_complexity)
    VALUES
      (${versionId},
       'The function contract supplies exactly one integer, so the complete algorithm is a direct indexed return.',
       'A loop could copy the only value into another variable before returning it, but the scan adds no value.',
       'Return values[0] directly. No additional state or transformation is needed for this contract.',
       'The constraints guarantee one element. values[0] is therefore the supplied signal, and returning it exactly satisfies the requested output for every valid input.',
       'O(1)', 'O(1)')
  `;

  const templates = [
    [
      'c11',
      'C',
      'long long solve(const long long *values, int n)',
      'long long solve(const long long *values, int n) { return values[0]; }',
      '#include <stdio.h>\n/*__USER_CODE__*/\nint main(){long long x;scanf("%lld",&x);printf("%lld",solve(&x,1));}',
    ],
    [
      'cpp17',
      'C++',
      'long long solve(const vector<long long>& values)',
      'long long solve(const vector<long long>& values) { return values[0]; }',
      '#include <bits/stdc++.h>\nusing namespace std;\n/*__USER_CODE__*/\nint main(){long long x;cin>>x;cout<<solve(vector<long long>{x});}',
    ],
    [
      'java',
      'Java',
      'static long solve(long[] values)',
      'static long solve(long[] values) { return values[0]; }',
      'import java.util.*;\npublic class Main{/*__USER_CODE__*/\npublic static void main(String[]a){Scanner s=new Scanner(System.in);System.out.print(solve(new long[]{s.nextLong()}));}}',
    ],
    [
      'python3',
      'Python',
      'def solve(values: list[int]) -> int',
      'def solve(values: list[int]) -> int:\n    return values[0]',
      '/*__USER_CODE__*/\nif __name__ == "__main__":\n import sys\n print(solve([int(sys.stdin.read())]))',
    ],
    [
      'javascript',
      'JavaScript',
      'function solve(values)',
      'function solve(values) { return values[0]; }',
      'const fs=require("fs");\n/*__USER_CODE__*/\nconsole.log(String(solve([Number(fs.readFileSync(0,"utf8"))])));',
    ],
  ] as const;
  for (const [language, displayName, functionSignature, source, wrapper] of templates) {
    await sql`
      INSERT INTO problem_language_templates
        (problem_version_id, language, display_name, runtime_version, function_signature,
         starter_code, wrapper_template, serialization, reference_solution,
         validation_hash, last_validated_at)
      VALUES
        (${versionId}, ${language}, ${displayName}, 'e2e-runtime', ${functionSignature},
         ${source}, ${wrapper},
         ${JSON.stringify({ input: 'One integer.', output: 'One integer.', equality: 'exact_json' })}::jsonb,
         ${source}, 'e2e-validated-hash', now())
    `;
  }
  await sql`
    INSERT INTO test_cases
      (problem_version_id, ordinal, visibility, coverage, input, expected_output, is_performance)
    VALUES
      (${versionId}, 1, 'sample', 'sample', '7', '7', false),
      (${versionId}, 2, 'visible', 'typical', '-3', '-3', false),
      (${versionId}, 3, 'hidden', 'minimum', '0', '0', false),
      (${versionId}, 4, 'hidden', 'duplicates', '11', '11', false),
      (${versionId}, 5, 'hidden', 'maximum', ${HIDDEN_SENTINEL}, ${HIDDEN_SENTINEL}, true),
      (${versionId}, 6, 'hidden', 'adversarial', '-9999', '-9999', false)
  `;
  const [company] = await sql`
    INSERT INTO companies (slug, name, overview)
    VALUES (${COMPANY_SLUG}, 'E2E Native Company',
            'A descriptive browser-test company used only to verify the original company preparation routes.')
    RETURNING id
  `;
  await sql`
    INSERT INTO problem_company_evidence
      (problem_id, company_id, evidence_type, verification_status)
    VALUES (${problemId}, ${company!.id}, 'company_pattern', 'unverified')
  `;
  const [paper] = await sql`
    INSERT INTO assessment_papers
      (company_id, slug, title, role, pattern_period, paper_type, duration_minutes,
       instructions, status, content_license_id)
    VALUES
      (${company!.id}, ${PAPER_SLUG}, 'E2E Original Pattern Mock', 'Software Engineer',
       'Evergreen original practice', 'pattern_based_mock', 45,
       'This independently authored browser fixture is a pattern-based mock, not an official or verified past paper.',
       'published', ${licenseId})
    RETURNING id
  `;
  await sql`
    INSERT INTO assessment_paper_questions (paper_id, problem_id, ordinal, marks)
    VALUES (${paper!.id}, ${problemId}, 1, 100)
  `;
});

test.afterAll(async () => {
  await sql`DELETE FROM assessment_papers WHERE slug = ${PAPER_SLUG}`;
  await deleteProblems(sql, SLUG);
  await sql`DELETE FROM companies WHERE slug = ${COMPANY_SLUG}`;
  await sql`DELETE FROM content_licenses WHERE id = ${licenseId}`;
  await cleanup(sql);
  await sql.end();
});

test.beforeEach(async ({ context, baseURL }) => {
  await signInAs(context, sql, { email: 'native-platform@e2e.test', baseUrl: baseURL! });
});

for (const viewport of [
  { width: 375, height: 812 },
  { width: 1440, height: 900 },
]) {
  test(`native solve page is usable at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto(`/problems/${SLUG}/solve`);
    await expect(page.getByRole('heading', { name: 'Native Signal Count' })).toBeVisible();
    await expect(page.getByLabel('Language')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Run Code' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Submit' })).toBeVisible();
    await page.getByRole('button', { name: 'Editorial' }).click();
    await expect(page.getByText(/return values\[0\] directly/i)).toBeVisible();
    expect(await page.locator('body').innerText()).not.toContain(HIDDEN_SENTINEL);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      ),
    ).toBeLessThanOrEqual(0);
  });
}

test('Run Code and Submit use native tests without leaking hidden values', async ({ page }) => {
  await page.goto(`/problems/${SLUG}/solve`);
  await page.getByRole('button', { name: 'Run Code' }).click();
  await expect(page.getByTestId('run-verdict')).toHaveText('Accepted', { timeout: 20_000 });
  await page.getByRole('button', { name: 'Submit' }).click();
  await expect(page.getByTestId('run-verdict')).toHaveText('Accepted', { timeout: 20_000 });
  expect(await page.locator('body').innerText()).not.toContain(HIDDEN_SENTINEL);
});

test('company and mock-paper routes show honest labels', async ({ page }) => {
  await page.goto(`/companies/${COMPANY_SLUG}`);
  await expect(page.getByRole('heading', { name: 'E2E Native Company' })).toBeVisible();
  await expect(
    page.getByRole('link', { name: /Native Signal Count.*Company pattern/i }),
  ).toBeVisible();
  await page.goto(`/companies/${COMPANY_SLUG}/papers/${PAPER_SLUG}`);
  await expect(page.getByRole('heading', { name: 'E2E Original Pattern Mock' })).toBeVisible();
  await expect(page.getByText(/pattern-based mock/i).first()).toBeVisible();
});
