import { expect, test } from '@playwright/test';
import type postgres from 'postgres';
import { cleanup, db, deleteProblems, signInAs } from './helpers/auth';

const enabled = process.env.RUN_VERCEL_SANDBOX_E2E === '1';
const SLUG = 'execution-queue-preview-contract';
const EMAIL = 'execution-queue@e2e.test';
let sql: ReturnType<typeof postgres>;

const samples = {
  c11: '#include <stdio.h>\nint main(void){puts("42");return 0;}',
  cpp17: '#include <iostream>\nint main(){std::cout << 42 << "\\n";}',
  java: 'public class Main { public static void main(String[] a) { System.out.println(42); } }',
  python3: 'print(42)',
  javascript: 'console.log(42);',
} as const;

test.describe('manual Vercel Queue + Sandbox release gate', () => {
  test.skip(
    !enabled,
    'Set RUN_VERCEL_SANDBOX_E2E=1 only for a controlled preview release gate.',
  );

  test.beforeAll(async () => {
    sql = db();
    await sql`
      INSERT INTO problems (slug, title, source_type, platform, external_url, difficulty, status)
      VALUES (${SLUG}, 'Execution Queue Preview Contract', 'external_link', 'leetcode',
              ${`https://leetcode.com/problems/${SLUG}/`}, 'easy', 'published')
      ON CONFLICT (slug) DO NOTHING
    `;
  });

  test.afterAll(async () => {
    if (!sql) return;
    await deleteProblems(sql, SLUG);
    await cleanup(sql);
    await sql.end();
  });

  test.beforeEach(async ({ context, baseURL }) => {
    await signInAs(context, sql, { email: EMAIL, baseUrl: baseURL! });
  });

  for (const [language, source] of Object.entries(samples)) {
    test(`${language} completes through durable dispatch`, async ({ page }) => {
      await page.goto(`/problems/${SLUG}/solve`);
      await page.getByLabel('Language').selectOption(language);
      const editor = page.locator('.monaco-editor textarea').first();
      await editor.click();
      await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
      await page.keyboard.insertText(source);
      await page.getByRole('button', { name: /^run code$/i }).click();
      await expect(page.getByTestId('run-output-output')).toContainText('42', {
        timeout: 120_000,
      });
    });
  }
});
