import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { FakeExecutionProvider } from '@/server/services/execution/provider';
import { validateNativeProblemReferences } from '@/server/services/admin';

describe('native admin security boundaries', () => {
  it('requires server admin authorization in actions and the sensitive export route', async () => {
    const files = await Promise.all([
      readFile('app/admin/problems/[problemId]/actions.ts', 'utf8'),
      readFile('app/admin/companies/actions.ts', 'utf8'),
      readFile('app/admin/papers/actions.ts', 'utf8'),
      readFile('app/admin/content-transfer/actions.ts', 'utf8'),
      readFile('app/api/admin/native-export/route.ts', 'utf8'),
    ]);
    for (const source of files) expect(source).toContain("requireCurrentUser('admin')");
  });

  it('refuses to certify references with the fake development executor', async () => {
    await expect(
      validateNativeProblemReferences(
        {} as never,
        '00000000-0000-4000-8000-000000000001',
        '00000000-0000-4000-8000-000000000002',
        new FakeExecutionProvider(),
      ),
    ).rejects.toThrow('real external execution provider');
  });
});
