import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { nativeProblemBatchSchema, validateNativeLibrary } from './schema';

export const NATIVE_PROBLEM_DATA_DIR = 'data/native-problems';

/**
 * Where a record goes when it stops being part of the library.
 *
 * 84 duplicates moved here on 2026-09-22. Five of those ten batch files were
 * then DELETED on 2026-09-22 — `batch-04`, `-05`, `-07`, `-09` and `-10` — for
 * holding example inputs copied from an external platform (C1/C2). The 42
 * records in the surviving five hold none and stay. **Deleting them from the
 * tip does not remove them from history**; see D29.
 *
 * Two consequences of that delete, both deliberate:
 *
 * - The surviving batch numbers are 1, 2, 3, 6, 8 — a gap. That is harmless
 *   because nothing runs `validateNativeLibrary` over this folder any more;
 *   `assertRetiredDisjoint` reads the files directly and does not validate.
 *   Do not renumber them to close the gap: the numbers are what tie a file to
 *   the batch it was retired from.
 * - Retired records are no longer a corpus anything imports. `importer.test.ts`
 *   used to load this folder for its idempotency run and does not any more.
 *
 * Nothing loads this folder as a library — `BATCH_FILE` does not match a
 * directory name, so `readdir` skips it without needing a rule — but it IS read
 * by `assertRetiredDisjoint` below, so a retired slug cannot quietly come back.
 */
export const RETIRED_PROBLEM_DIR = 'retired';

/** `batch-07.json`, and nothing else in the directory. */
const BATCH_FILE = /^batch-(\d+)\.json$/;

/**
 * A slug lives in the active library or in `retired/`, never both.
 *
 * Without this, restoring one record by copying it back leaves two copies that
 * disagree — and the active one wins silently, so the retired copy reads as a
 * historical record while actually being dead weight. The failure this prevents
 * is a slug that looks retired but is being imported.
 *
 * Missing folder is not an error: a library that has retired nothing is fine.
 */
async function assertRetiredDisjoint(directory: string, activeSlugs: ReadonlySet<string>) {
  const retiredDirectory = join(directory, RETIRED_PROBLEM_DIR);

  let names: string[];
  try {
    names = await readdir(retiredDirectory);
  } catch {
    return;
  }

  const clashes: string[] = [];
  for (const name of names.filter((entry) => BATCH_FILE.test(entry))) {
    const payload: unknown = JSON.parse(await readFile(join(retiredDirectory, name), 'utf8'));
    const problems = (payload as { problems?: { slug?: string }[] }).problems ?? [];
    for (const problem of problems) {
      if (problem.slug && activeSlugs.has(problem.slug)) clashes.push(problem.slug);
    }
  }

  if (clashes.length > 0) {
    throw new Error(
      `These slugs are in BOTH the active library and ${RETIRED_PROBLEM_DIR}/: ` +
        `${[...new Set(clashes)].sort().join(', ')}. A slug belongs to one or the other.`,
    );
  }
}

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

  await assertRetiredDisjoint(
    directory,
    new Set(batches.flatMap((batch) => batch.problems.map((problem) => problem.slug))),
  );

  return batches;
}
