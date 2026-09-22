/**
 * F4.1 · the active library, and what was retired out of it.
 *
 * 94 of the original 100 records were ten tasks reskinned — same reference
 * solution, same contract, same worked example, different titles, and labelled
 * easy AND medium AND hard. 84 duplicates moved to `data/native-problems/
 * retired/` on 2026-09-22, archived in the database and loaded by nothing.
 *
 * Five of those ten batch files were then deleted for holding example inputs
 * copied from an external platform. **That is why this file no longer asserts a
 * count of 84.** A count is the wrong guard for a folder whose whole purpose is
 * to shrink: it would have to be edited every time a record is removed, which
 * makes it a chore rather than a check, and a chore gets edited to match
 * whatever happened rather than to state what should be true.
 *
 * What is worth holding down survives the delete unchanged:
 *
 * 1. The retired folder really is invisible to the loader — "it is ignored" is
 *    exactly the sort of claim that passes because the test looked in the wrong
 *    place, so it is asserted against the folder's actual contents.
 * 2. A slug cannot be in both halves. That is only worth asserting if the
 *    assertion can fail, so there is a positive control for it.
 * 3. Retiring means relocating, not editing: a record still in `retired/` must
 *    still be a well-formed record, or "we kept it" is not true.
 *
 * The one thing deliberately NOT asserted here is that the five deleted files
 * are gone from git. They are not — history still holds them, and a test that
 * implied otherwise would be worse than no test. See D29.
 */
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  readdirSync,
  readFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  NATIVE_PROBLEM_DATA_DIR,
  RETIRED_PROBLEM_DIR,
  loadNativeProblemBatches,
} from '@/server/services/native-content/load';
import {
  NATIVE_DIFFICULTY_DISTRIBUTION,
  NATIVE_TOPIC_DISTRIBUTION,
} from '@/server/services/native-content/schema';

const RETIRED_PATH = join(NATIVE_PROBLEM_DATA_DIR, RETIRED_PROBLEM_DIR);

function readRecords(directory: string): { slug: string; title: string; difficulty: string }[] {
  return readdirSync(directory)
    .filter((name) => /^batch-\d+\.json$/.test(name))
    .flatMap((name) => {
      const payload = JSON.parse(readFileSync(join(directory, name), 'utf8')) as {
        problems: { slug: string; title: string; difficulty: string }[];
      };
      return payload.problems;
    });
}

const readSlugs = (directory: string) => readRecords(directory).map((problem) => problem.slug);

describe('F4.1 · the real library on disk', () => {
  it('loads exactly the active records, and none of the retired ones', async () => {
    const batches = await loadNativeProblemBatches();
    const loaded = batches.flatMap((batch) => batch.problems.map((problem) => problem.slug));
    const retired = readSlugs(RETIRED_PATH);

    expect(loaded).toHaveLength(16);

    // Not a count — a non-vacuity check. `not.toContain` over an empty list
    // passes for the wrong reason, so the loop below has to have something to
    // loop over before its result means anything.
    expect(retired.length).toBeGreaterThan(0);

    // The claim that matters: nothing retired came through the loader.
    for (const slug of retired) expect(loaded).not.toContain(slug);
  });

  it('the two sets are disjoint on disk', () => {
    const active = new Set(readSlugs(NATIVE_PROBLEM_DATA_DIR));
    const overlap = readSlugs(RETIRED_PATH).filter((slug) => active.has(slug));
    expect(overlap).toEqual([]);
  });

  it('what is still retired is still a whole record, not a stub', () => {
    // Retiring is relocation. A record that survived the 2026-09-22 delete must
    // still carry everything that made it a record — if some later cleanup
    // starts hollowing files out in place instead of removing them, this is
    // what notices.
    const retired = readRecords(RETIRED_PATH);
    expect(retired.length).toBeGreaterThan(0);
    for (const problem of retired) {
      expect(problem.slug, problem.slug).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
      expect(problem.title?.length ?? 0, problem.slug).toBeGreaterThan(0);
      expect(['easy', 'medium', 'hard'], problem.slug).toContain(problem.difficulty);
    }

    // Slugs are unique across the surviving files, so nothing was duplicated in
    // by a botched restore.
    expect(new Set(retired.map((problem) => problem.slug)).size).toBe(retired.length);
  });
});

describe('F4.1 · the re-based floors are met by the library they describe', () => {
  it('difficulty floors hold', async () => {
    const batches = await loadNativeProblemBatches();
    const counts: Record<string, number> = {};
    for (const batch of batches) {
      for (const problem of batch.problems) {
        counts[problem.difficulty] = (counts[problem.difficulty] ?? 0) + 1;
      }
    }
    for (const [level, floor] of Object.entries(NATIVE_DIFFICULTY_DISTRIBUTION)) {
      expect(counts[level] ?? 0, level).toBeGreaterThanOrEqual(floor);
    }
  });

  it('topic floors hold, and every declared topic is actually present', async () => {
    const batches = await loadNativeProblemBatches();
    const counts: Record<string, number> = {};
    for (const batch of batches) {
      for (const problem of batch.problems) {
        counts[problem.primaryTopic] = (counts[problem.primaryTopic] ?? 0) + 1;
      }
    }
    for (const [topic, floor] of Object.entries(NATIVE_TOPIC_DISTRIBUTION)) {
      expect(counts[topic] ?? 0, topic).toBeGreaterThanOrEqual(floor);
    }
  });

  it('the floors are not trivially satisfiable', () => {
    // A floor of 0 asserts nothing. This is what stopped the old constants
    // being quietly zeroed to make a failing library pass.
    for (const floor of Object.values(NATIVE_DIFFICULTY_DISTRIBUTION)) {
      expect(floor).toBeGreaterThan(0);
    }
    for (const floor of Object.values(NATIVE_TOPIC_DISTRIBUTION)) {
      expect(floor).toBeGreaterThan(0);
    }
  });
});

describe('F4.1 · the overlap guard can actually fail', () => {
  const made: string[] = [];

  afterEach(() => {
    for (const directory of made.splice(0)) rmSync(directory, { recursive: true, force: true });
  });

  /** A minimal library: one batch, copied from the real first active record. */
  function scratchLibrary(): { directory: string; slug: string } {
    const directory = mkdtempSync(join(tmpdir(), 'qc-lib-'));
    made.push(directory);

    const source = readdirSync(NATIVE_PROBLEM_DATA_DIR).find((name) =>
      /^batch-\d+\.json$/.test(name),
    )!;
    const payload = JSON.parse(readFileSync(join(NATIVE_PROBLEM_DATA_DIR, source), 'utf8')) as {
      schemaVersion: number;
      batch: number;
      reviewStatus: string;
      problems: { slug: string }[];
    };

    // The WHOLE active batch: a smaller slice breaches the difficulty floors
    // and `validateNativeLibrary` throws before the overlap check is reached,
    // which would make these tests pass for the wrong reason.
    writeFileSync(join(directory, 'batch-01.json'), JSON.stringify({ ...payload, batch: 1 }));
    return { directory, slug: payload.problems[0]!.slug };
  }

  it('loads cleanly when retired/ does not exist at all', async () => {
    const { directory } = scratchLibrary();
    await expect(loadNativeProblemBatches(directory)).resolves.toBeDefined();
  });

  it('loads cleanly when retired/ holds a DIFFERENT slug', async () => {
    const { directory } = scratchLibrary();
    const retired = join(directory, RETIRED_PROBLEM_DIR);
    mkdirSync(retired);
    const payload = JSON.parse(readFileSync(join(directory, 'batch-01.json'), 'utf8'));
    // EVERY slug has to differ — renaming one of sixteen leaves fifteen clashes
    // and the test would pass for the wrong reason.
    payload.problems = payload.problems.map((problem: { slug: string }, index: number) => ({
      ...problem,
      slug: `retired-only-${index}`,
    }));
    writeFileSync(join(retired, 'batch-09.json'), JSON.stringify(payload));

    await expect(loadNativeProblemBatches(directory)).resolves.toBeDefined();
  });

  it('THROWS when the same slug is in both', async () => {
    // The positive control. Without this the disjointness tests above could
    // be passing because the check never looks at anything.
    const { directory, slug } = scratchLibrary();
    const retired = join(directory, RETIRED_PROBLEM_DIR);
    mkdirSync(retired);
    writeFileSync(
      join(retired, 'batch-09.json'),
      readFileSync(join(directory, 'batch-01.json'), 'utf8'),
    );

    await expect(loadNativeProblemBatches(directory)).rejects.toThrow(
      new RegExp(`BOTH the active library and ${RETIRED_PROBLEM_DIR}`),
    );
    await expect(loadNativeProblemBatches(directory)).rejects.toThrow(slug);
  });
});
