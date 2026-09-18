import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { nativeProblemBatchSchema, validateNativeLibrary } from './schema';

export const NATIVE_PROBLEM_DATA_DIR = 'data/native-problems';

/** `batch-07.json`, and nothing else in the directory. */
const BATCH_FILE = /^batch-(\d+)\.json$/;

/**
 * Load every batch file in the directory, in batch-number order.
 *
 * This walked a fixed 1..10 range until 2026-09-18, which capped the library at
 * ten files and silently ignored a `batch-11.json`. Globbing lifts the cap, and
 * `validateNativeLibrary` takes on the guarantee the fixed range gave for free:
 * a missing file used to throw ENOENT, and now shows up as a gap in the batch
 * numbers instead.
 *
 * Sorted numerically, not lexically, so `batch-10.json` follows `batch-09.json`
 * rather than `batch-01.json`. Order is not load-bearing for validation, but it
 * is what the importer iterates, and a stable order keeps its output readable.
 */
export async function loadNativeProblemBatches(directory = NATIVE_PROBLEM_DATA_DIR) {
  const files = (await readdir(directory))
    .map((name) => ({ name, match: BATCH_FILE.exec(name) }))
    .filter((entry): entry is { name: string; match: RegExpExecArray } => entry.match !== null)
    .map((entry) => ({ name: entry.name, number: Number(entry.match[1]) }))
    .sort((left, right) => left.number - right.number);

  if (files.length === 0) {
    throw new Error(`No batch-NN.json files found in ${directory}.`);
  }

  const batches = [];
  for (const file of files) {
    const payload: unknown = JSON.parse(await readFile(join(directory, file.name), 'utf8'));
    batches.push(nativeProblemBatchSchema.parse(payload));
  }

  validateNativeLibrary(batches);
  return batches;
}
