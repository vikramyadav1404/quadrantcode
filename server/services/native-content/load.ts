import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { nativeProblemBatchSchema, validateNativeLibrary } from './schema';

export const NATIVE_PROBLEM_DATA_DIR = 'data/native-problems';

export async function loadNativeProblemBatches(directory = NATIVE_PROBLEM_DATA_DIR) {
  const batches = [];
  for (let batch = 1; batch <= 10; batch += 1) {
    const path = join(directory, `batch-${String(batch).padStart(2, '0')}.json`);
    const payload: unknown = JSON.parse(await readFile(path, 'utf8'));
    batches.push(nativeProblemBatchSchema.parse(payload));
  }

  validateNativeLibrary(batches);
  return batches;
}
